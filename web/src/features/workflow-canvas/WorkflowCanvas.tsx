import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import GlowNode from '@/components/GlowNode'
import TerminalNode from '@/components/TerminalNode'
import GradientEdge from '@/components/GradientEdge'
import { autoLayout } from './AutoLayout'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useExecutionStore } from '@/stores/executionStore'
import { useNodeStore } from '@/stores/nodeStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { parseWorkflowGraph, parseNodeRefs, parseNodeParams } from '@/utils/mermaidParser'
import { updateWorkflow } from '@/services/workflowService'
import { useEventStream } from '@/services/eventService'
import type { ExecutionLog, ExecutionStatus } from '@/types/execution'
import { ArrowUpDown, ArrowLeftRight, Eye, PencilLine, History } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const nodeTypes = { glowNode: GlowNode, terminalNode: TerminalNode }
const edgeTypes = { gradientEdge: GradientEdge }

// 节点参数防抖持久化的挂起冲刷句柄（模块级，画布单实例）
// 运行流水线从 DB 读 YAML：800ms 防抖窗口内点击运行会拿到旧参数，
// 运行前必须 await flushNodeParamsPersist() 把挂起的 PUT 立即落库
let pendingParamsFlush: (() => Promise<void>) | null = null

/** 冲刷节点参数写回的防抖持久化；无挂起变更时立即返回 */
export async function flushNodeParamsPersist(): Promise<void> {
  if (pendingParamsFlush) await pendingParamsFlush()
}

const statusMap: Record<string, string> = {
  running: 'running',
  success: 'success',
  failed: 'failed',
}

// 简单的 semver 比较（1.10.0 > 1.2.0），用于同名节点取最新版本
function compareVersion(a?: string, b?: string): number {
  const pa = (a || '0').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = (b || '0').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

// 判断边是否处于活跃（高亮）状态：目标节点 running 时，只有「目标上一轮结束后
// 又完成过一次」的源节点入边才亮——循环图中可区分正向边与回边的真实触发来源；
// 无时间戳数据（打开历史执行/中途进入运行）时回退为「目标运行即亮」
function isEdgeActive(
  edge: Edge,
  statuses: Record<string, string>,
  completedAt: Record<string, number>,
  prevCompletedAt: Record<string, number>,
): boolean {
  if (statuses[edge.target] !== 'running') return false
  if (Object.keys(completedAt).length === 0) return true
  const sourceAt = completedAt[edge.source]
  if (!sourceAt) return false
  return sourceAt > (prevCompletedAt[edge.target] ?? 0)
}

// 判断边是否已走过（实线）：两端当前都成功，或两端都曾真实完成过。
// 完成时间戳只在真实 running → 终态时更新（循环迭代中跳过上游节点
// 重发的 node_complete 不污染），且只增不减——因此循环体外的入环边在
// 目标节点重跑（running）期间保持实线，不会回退成 idle 流动虚线
function isEdgeTraversed(
  source: string,
  target: string,
  statuses: Record<string, string>,
  completedAt: Record<string, number>,
): boolean {
  if (statuses[source] === 'success' && statuses[target] === 'success') return true
  return completedAt[source] !== undefined && completedAt[target] !== undefined
}

function WorkflowCanvasInner({
  action,
  onShowHistory,
}: {
  action?: React.ReactNode
  onShowHistory?: () => void
}) {
  const { t } = useTranslation()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [direction, setDirection] = useState<'TB' | 'LR'>('TB')
  // preview：只能平移画布；edit：可拖动节点、切换布局方向
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  // 解析 effect 不能依赖 mode（切换模式重跑 mermaid+dagre 会丢失手动拖动的位置），
  // 构建节点 data 时通过 ref 读当前模式；mode 变化由独立 effect 同步 data.interactive
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [, setSelectedNode] = useState<string | null>(null)
  // 精确选择器订阅：避免 store 中无关字段变化触发整个画布重渲染
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow)
  const nodeStatuses = useWorkflowStore((s) => s.nodeStatuses)
  const nodeCompletedAt = useWorkflowStore((s) => s.nodeCompletedAt)
  const nodePrevCompletedAt = useWorkflowStore((s) => s.nodePrevCompletedAt)
  const nodeRuntimeData = useWorkflowStore((s) => s.nodeRuntimeData)
  const updateNodeStatus = useWorkflowStore((s) => s.updateNodeStatus)
  const setNodeStatuses = useWorkflowStore((s) => s.setNodeStatuses)
  const setNodeRuntimeData = useWorkflowStore((s) => s.setNodeRuntimeData)
  const resetNodeRuntimeData = useWorkflowStore((s) => s.resetNodeRuntimeData)
  const nodeDefs = useNodeStore((s) => s.nodes)
  const loadNodes = useNodeStore((s) => s.loadNodes)
  const selectedExecutionId = useExecutionStore((s) => s.selectedExecutionId)
  const runningExecutionId = useExecutionStore((s) => s.runningExecutionId)
  const selectedExecutionYaml = useExecutionStore((s) => s.selectedExecutionYaml)
  // 顶部栏展示的执行 ID：优先选中（回放）的执行，其次正在运行的执行
  const liveExecutionId = selectedExecutionId ?? runningExecutionId

  // 画布图数据源：回放态（选中执行且有快照）用该执行的运行时快照渲染——
  // 快照是该执行的独立图定义（续跑追加节点后与模板已解耦）；
  // 编辑态或无快照的旧执行回退用流水线模板
  const sourceYaml =
    selectedExecutionId && selectedExecutionYaml
      ? selectedExecutionYaml
      : currentWorkflow?.yamlConfig

  // 仅编辑态（数据源为流水线模板）允许组件写回参数；回放态快照只读
  const paramsEditable = !!currentWorkflow && sourceYaml === currentWorkflow.yamlConfig

  // 组件 onParamsChange → 写回内存 yamlConfig（workflowStore.updateNodeParams）
  // → 防抖持久化到后端（滑杆类控件会连续触发，合并为一次 PUT）
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistNow = useCallback(async () => {
    const latest = useWorkflowStore.getState().currentWorkflow
    if (!latest) return
    try {
      await updateWorkflow(latest.id, {
        name: latest.name,
        description: latest.description,
        intent: latest.intent,
        yamlConfig: latest.yamlConfig,
        status: latest.status,
      })
    } catch (err) {
      console.error('Failed to persist node params:', err)
    }
  }, [])
  const handleNodeParamsChange = useCallback((nodeId: string, params: Record<string, string>) => {
    useWorkflowStore.getState().updateNodeParams(nodeId, params)
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    // 挂起期间注册模块级冲刷句柄：运行流水线从 DB 读 YAML，
    // 800ms 防抖窗口内点运行会用到旧参数，运行前必须 await 冲刷
    pendingParamsFlush = async () => {
      if (!persistTimerRef.current) return
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
      pendingParamsFlush = null
      await persistNow()
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      pendingParamsFlush = null
      persistNow()
    }, 800)
  }, [persistNow])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      pendingParamsFlush = null
    }
  }, [])

  // 节点包列表用于按 nodeRef 匹配 ui 配置；每次进入画布都刷新，
  // 保证节点重新导入（ui 尺寸/bundle 更新）后能拿到最新定义
  useEffect(() => {
    loadNodes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 解析 YAML Graph 并渲染工作流
  useEffect(() => {
    if (!sourceYaml) {
      setNodes([])
      setEdges([])
      return
    }

    // 节点实例 ID → 节点包名 → 节点包定义（含 ui 配置）
    const nodeRefs = parseNodeRefs(sourceYaml)
    // 节点实例 ID → 当前参数绑定（config.params），下发给节点自定义 UI 组件
    const nodeParams = parseNodeParams(sourceYaml)
    const matchNodeDef = (instanceId: string) => {
      const ref = nodeRefs[instanceId]
      if (!ref) return undefined
      // 快照物化后 nodeRef 带版本锁（echo@1.1.0）：按 名称+版本 精确匹配；
      // 裸名称（模板编写态）或锁定版本已被删除时，回退同名最新版本——
      // 与后端裸 nodeRef 解析到最新版本的语义一致
      const at = ref.lastIndexOf('@')
      const name = at > 0 ? ref.slice(0, at) : ref
      const version = at > 0 ? ref.slice(at + 1) : ''
      const candidates = nodeDefs.filter((n) => n.name === name)
      if (version) {
        const exact = candidates.find((n) => n.version === version)
        if (exact) return exact
      }
      return candidates.sort((a, b) => compareVersion(b.version, a.version))[0]
    }

    // 过期取消：首次进入时 mermaid 动态加载较慢，若 nodeDefs 在此期间加载完成
    // 触发了新一轮解析，旧的慢解析结果不得覆盖新结果（否则子 UI 首次不显示）
    let cancelled = false

    parseWorkflowGraph(sourceYaml)
      .then(({ nodes: parsedNodes, edges: parsedEdges }) => {        // 状态读取必须取解析完成时刻的最新值（getState），不能用 effect 闭包快照：
        // mermaid 解析是异步的，期间 selectExecutionAndSync 可能已把执行状态
        // 同步进 store（选中/清除历史执行），用闭包快照重建节点会把刚同步的
        // 状态用旧值覆盖（出现「选中显示 idle、清除反而显示 success」的反转）
        const {
          nodeStatuses: curStatuses,
          nodeCompletedAt: curCompletedAt,
          nodePrevCompletedAt: curPrevCompletedAt,
          nodeRuntimeData: curRuntimeData,
        } = useWorkflowStore.getState()

        const rawNodes: Node[] = parsedNodes.map((n) => {
          const nodeDef = n.id === '__start__' || n.id === '__end__' ? undefined : matchNodeDef(n.id)
          return {
            id: n.id,
            type: n.id === '__start__' || n.id === '__end__' ? 'terminalNode' : 'glowNode',
            position: { x: 0, y: 0 },
            data: {
              id: n.id,
              name: n.label,
              status: curStatuses[n.id] || 'idle',
              accentColor: nodeDef?.ui ? '#a855f7' : '#6366f1',
              inputs: curRuntimeData[n.id]?.inputs,
              outputs: curRuntimeData[n.id]?.outputs,
              direction,
              nodeRef: nodeDef?.name,
              nodeDbId: nodeDef?.id,
              nodeUpdatedAt: nodeDef?.updatedAt ? String(nodeDef.updatedAt) : undefined,
              ui: nodeDef?.ui,
              params: nodeParams[n.id],
              // 非编辑（预览）模式：节点不可选中、内嵌 UI 不可交互
              interactive: modeRef.current === 'edit',
              onParamsChange: paramsEditable
                ? (params: Record<string, string>) => handleNodeParamsChange(n.id, params)
                : undefined,
            },
          }
        })

        const rawEdges: Edge[] = parsedEdges.map((e, idx) => ({
          id: `e${idx}`,
          source: e.source,
          target: e.target,
          sourceHandle: 'source',
          targetHandle: 'target',
          type: 'gradientEdge',
          data: {
            animated: isEdgeActive(
              { source: e.source, target: e.target } as Edge,
              curStatuses,
              curCompletedAt,
              curPrevCompletedAt,
            ),
            traversed: isEdgeTraversed(e.source, e.target, curStatuses, curCompletedAt),
            label: e.label,
          },
        }))

        const { nodes: layoutedNodes, edges: layoutedEdges } = autoLayout(rawNodes, rawEdges, { direction })
        if (cancelled) return
        setNodes(layoutedNodes)
        setEdges(layoutedEdges)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to parse workflow graph:', err)
        setNodes([])
        setEdges([])
      })

    return () => {
      cancelled = true
    }
  }, [sourceYaml, direction, nodeDefs, paramsEditable, handleNodeParamsChange, setNodes, setEdges])

  // 模式切换时只同步节点的 interactive 标记（不重跑图解析/布局，保留手动位置）
  useEffect(() => {
    const interactive = mode === 'edit'
    setNodes((nds) =>
      nds.map((node) =>
        node.data.interactive === interactive
          ? node
          : { ...node, data: { ...node.data, interactive } },
      ),
    )
  }, [mode, setNodes])

  // 按实测尺寸重排：首帧布局只能按估算尺寸占位，组件挂载/详情展开后节点实际
  // 尺寸会变化（React Flow 自动测量到 node.measured），此处检测到变化后重跑 dagre，
  // 避免节点重叠。key 不含位置，重排只改 position 不改变 measured，因此不会循环。
  const layoutKeyRef = useRef('')
  useEffect(() => {
    if (nodes.length === 0) return
    if (!nodes.every((n) => n.measured?.width && n.measured?.height)) return
    const key =
      direction +
      '|' +
      nodes
        .map((n) => `${n.id}:${Math.round(n.measured!.width!)}x${Math.round(n.measured!.height!)}`)
        .join('|')
    if (key === layoutKeyRef.current) return
    layoutKeyRef.current = key
    const { nodes: layouted } = autoLayout(nodes, edges, { direction })
    setNodes(layouted)
  }, [nodes, edges, direction, setNodes])

  // 实时同步执行状态：空状态表（退出回放态/新执行开始）时全量复位为 idle，
  // 不能 early-return，否则上一轮的着色会残留在节点上
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const status = nodeStatuses[node.id] || 'idle'
        if (status !== node.data.status) {
          return {
            ...node,
            data: { ...node.data, status },
          }
        }
        return node
      })
    )

    setEdges((eds) =>
      eds.map((edge) => ({
        ...edge,
        data: {
          ...edge.data,
          animated: isEdgeActive(edge, nodeStatuses, nodeCompletedAt, nodePrevCompletedAt),
          traversed: isEdgeTraversed(edge.source, edge.target, nodeStatuses, nodeCompletedAt),
          status: nodeStatuses[edge.target] === 'failed' ? 'failed' : 'normal',
        },
      }))
    )
  }, [nodeStatuses, nodeCompletedAt, nodePrevCompletedAt, setNodes, setEdges])

  // 同步节点运行时数据（入参和返回）：退出回放态时 nodeRuntimeData 清空，
  // 此处同步清掉节点上残留的 inputs/outputs，不能 early-return
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const runtime = nodeRuntimeData[node.id]
        const inputs = runtime?.inputs
        const outputs = runtime?.outputs

        // 引用未变直接跳过：一次更新中大多数节点没有变化
        if (inputs === node.data.inputs && outputs === node.data.outputs) {
          return node
        }

        return {
          ...node,
          data: {
            ...node.data,
            inputs,
            outputs,
          },
        }
      })
    )
  }, [nodeRuntimeData, setNodes])

  const selectedExecution = useExecutionStore((s) => s.selectedExecution)

  // 将执行实例 metadata 中的节点输出（扁平点键：GetWeather.city）按节点分发到 nodeRuntimeData，
  // 驱动画布节点的「返回」区域与自定义 UI 组件展示真实数据
  useEffect(() => {
    const meta = selectedExecution?.metadata as Record<string, unknown> | undefined
    const runtime = (meta?.metadata ?? {}) as Record<string, unknown>
    const byNode: Record<string, Record<string, string>> = {}
    for (const [key, value] of Object.entries(runtime)) {
      const dot = key.indexOf('.')
      if (dot <= 0) continue
      const nodeId = key.slice(0, dot)
      const field = key.slice(dot + 1)
      if (!byNode[nodeId]) byNode[nodeId] = {}
      byNode[nodeId][field] = typeof value === 'string' ? value : JSON.stringify(value)
    }
    for (const [nodeId, outputs] of Object.entries(byNode)) {
      setNodeRuntimeData(nodeId, { outputs })
    }
  }, [selectedExecution, setNodeRuntimeData])

  // 订阅 SSE 事件
  useEventStream('/api/v1/events', (type, data) => {
    if (type === 'execution.started') {
      setNodeStatuses({})
      resetNodeRuntimeData()
      const payload = data as { execution_id?: number }
      if (payload.execution_id) {
        const id = String(payload.execution_id)
        useExecutionStore.getState().startExecution(id)
        useExecutionStore.getState().selectExecution(id)
      }
      return
    }

    if (type === 'execution_start') {
      const payload = data as {
        execution_id?: number
        params?: Record<string, unknown>
      }
      if (payload.execution_id) {
        useExecutionStore.getState().updateExecutionMetadata(String(payload.execution_id), {
          status: 'running',
          params: payload.params || {},
        })
      }
      return
    }

    if (type === 'execution_paused') {
      const payload = data as { execution_id?: number }
      if (payload.execution_id) {
        useExecutionStore.getState().updateExecutionStatus(String(payload.execution_id), 'paused')
      }
      return
    }

    if (type === 'execution_resumed') {
      const payload = data as { execution_id?: number }
      if (payload.execution_id) {
        useExecutionStore.getState().updateExecutionStatus(String(payload.execution_id), 'running')
      }
      return
    }

    if (type === 'node_start') {
      const payload = data as { node_id?: string }
      if (payload.node_id) updateNodeStatus(payload.node_id, 'running')
      return
    }

    if (type === 'node_complete') {
      const payload = data as {
        node_id?: string
        status?: string
        // 后端 persistRuntimeEvent 会把事件 Data 展开到顶层，outputs 与 node_id 平级
        outputs?: Record<string, unknown>
      }
      if (payload.node_id) {
        updateNodeStatus(payload.node_id, statusMap[payload.status || ''] || 'idle')
        // 节点输出随 node_complete 实时下发：驱动画布节点 UI 即时展示输出，
        // 不必等执行结束后 metadata 的一次性同步（循环中跳过节点重发的事件
        // 携带相同输出，重复设置幂等无副作用）
        const outputs = payload.outputs
        if (outputs && Object.keys(outputs).length > 0) {
          const normalized: Record<string, string> = {}
          for (const [k, v] of Object.entries(outputs)) {
            normalized[k] = typeof v === 'string' ? v : JSON.stringify(v)
          }
          setNodeRuntimeData(payload.node_id, { outputs: normalized })
        }
      }
      return
    }

    if (type === 'execution.log') {
      const payload = data as {
        execution_id?: number
        node_id?: string
        node_name?: string
        step_name?: string
        level?: string
        message?: string
        output?: string
        timestamp?: string
      }
      if (payload.execution_id) {
        useExecutionStore.getState().appendRealtimeLog({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          executionId: payload.execution_id,
          nodeId: payload.node_id,
          nodeName: payload.node_name || payload.node_id || 'system',
          stepName: payload.step_name,
          level: (payload.level?.toUpperCase() as ExecutionLog['level']) || 'INFO',
          message: payload.message || '',
          output: payload.output,
          timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
        })
      }
      return
    }

    if (type === 'execution_complete') {
      const payload = data as {
        execution_id?: number
        status?: string
        params?: Record<string, unknown>
        metadata?: Record<string, unknown>
      }
      if (payload.execution_id) {
        useExecutionStore.getState().updateExecutionMetadata(String(payload.execution_id), {
          status: (payload.status || 'success').toLowerCase(),
          params: payload.params || {},
          metadata: payload.metadata || {},
        })
        // 续跑（continue）不产生 execution.completed 事件，此处兜底结束运行态；
        // 普通运行该调用幂等（随后的 execution.completed 会重复设置，无副作用）
        useExecutionStore.getState().stopExecution()
      }
      return
    }

    if (type === 'execution.completed') {
      const payload = data as { execution_id?: number; status?: string }
      if (payload.execution_id) {
        useExecutionStore.getState().stopExecution()
        useExecutionStore.getState().updateExecutionStatus(
          String(payload.execution_id),
          (payload.status as ExecutionStatus['status']) || 'success'
        )
        useExecutionStore.getState().selectExecution(String(payload.execution_id))
      }
    }
  })

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id)
  }, [])

  const isMobile = useIsMobile()

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: isMobile ? 0.1 : 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={mode === 'edit'}
        nodesConnectable={false}
        elementsSelectable={mode === 'edit'}
        panOnScroll={true}
        panOnDrag={true}
        selectionOnDrag={false}
        className="canvas-background"
      >
        {/* 星空点阵背景 */}
        <Background
          color="var(--canvas-dots)"
          gap={isMobile ? 16 : 24}
          size={1}
          style={{ background: 'transparent' }}
        />

        {/* 控制按钮 - 移动端隐藏 */}
        {!isMobile && (
          <Controls
            className="!bg-white/5 !border-white/10 !backdrop-blur-xl !rounded-xl"
            style={{
              // @ts-expect-error React Flow custom style
              button: { background: 'transparent', color: 'rgb(var(--color-ink) / 0.6)', border: 'none' },
            }}
          />
        )}

        {/* 小地图 - 移动端隐藏 */}
        {!isMobile && (
          <MiniMap
            className="!bg-white/5 !border-white/10 !rounded-xl !backdrop-blur-xl"
            nodeColor={(node) => {
              const colors: Record<string, string> = {
                idle: '#94a3b8',
                running: '#22d3ee',
                success: '#34d399',
                failed: '#fb7185',
                skipped: '#64748b',
              }
              return colors[node.data?.status as string] || '#94a3b8'
            }}
            maskColor="var(--minimap-mask)"
          />
        )}

      </ReactFlow>

      {/* 顶部工具栏：流水线名称/ID + 当前执行 ID + 运行控制按钮。
          不再使用浮动画布上的圆角胶囊（Panel），改为固定顶栏 */}
      <div
        className={`absolute top-0 inset-x-0 z-10 flex items-center gap-2
                    border-b border-white/10 bg-panel/80 backdrop-blur-2xl
                    ${isMobile ? 'h-11 px-2' : 'h-12 px-4'}`}
      >
        {/* 左侧：流水线名称 + 流水线 ID + 当前执行 ID */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={`text-white/80 font-medium truncate ${isMobile ? 'text-xs' : 'text-sm'}`}
          >
            {currentWorkflow?.name || t('canvas.noWorkflowSelected')}
          </span>
          {currentWorkflow && (
            <span className="text-white/35 text-xs flex-shrink-0 font-mono">
              #{currentWorkflow.id}
            </span>
          )}
          {liveExecutionId && (
            <button
              onClick={onShowHistory}
              className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-mono
                         bg-indigo-400/10 text-indigo-300 border border-indigo-400/20
                         hover:bg-indigo-400/20 transition-colors cursor-pointer"
              title={t('canvas.history')}
            >
              {t('canvas.currentExecution')} #{liveExecutionId}
            </button>
          )}
        </div>

        {/* 右侧：运行/暂停按钮（action）+ 历史执行 + 预览/编辑切换 + 方向切换 */}
        {action}
        <button
          onClick={onShowHistory}
          className="p-1.5 rounded-md flex-shrink-0 transition-colors
                     text-white/60 hover:text-white/80 hover:bg-white/10"
          title={t('canvas.history')}
        >
          <History className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        </button>
        <button
          onClick={() => setMode((m) => (m === 'preview' ? 'edit' : 'preview'))}
          className={`p-1.5 rounded-md flex-shrink-0 transition-colors ${
            mode === 'edit'
              ? 'text-cyan-300 bg-cyan-400/15 hover:bg-cyan-400/25'
              : 'text-white/60 hover:text-white/80 hover:bg-white/10'
          }`}
          title={mode === 'preview' ? t('canvas.previewMode') : t('canvas.editMode')}
        >
          {mode === 'preview' ? (
            <Eye className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          ) : (
            <PencilLine className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          )}
        </button>
        <button
          onClick={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))}
          disabled={mode !== 'edit'}
          className={`p-1.5 rounded-md flex-shrink-0 transition-colors ${
            mode !== 'edit'
              ? 'text-white/25 cursor-not-allowed'
              : 'text-white/60 hover:text-white/80 hover:bg-white/10'
          }`}
          title={direction === 'TB' ? t('canvas.switchToHorizontal') : t('canvas.switchToVertical')}
        >
          {direction === 'TB' ? (
            <ArrowLeftRight className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          ) : (
            <ArrowUpDown className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          )}
        </button>
      </div>
    </div>
  )
}

export default function WorkflowCanvas({
  action,
  onShowHistory,
}: {
  action?: React.ReactNode
  onShowHistory?: () => void
}) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner action={action} onShowHistory={onShowHistory} />
    </ReactFlowProvider>
  )
}
