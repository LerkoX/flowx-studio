import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
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
import { syncCanvasStatusesFromExecutionNodes } from './executionSelection'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { parseWorkflowGraph, parseNodeRefs, parseNodeNames, parseNodeParams, parseParamSources } from '@/utils/mermaidParser'
import { updateWorkflow, getWorkflow, getWorkflowExecutors, getExecutions, getExecution, getExecutionMedia } from '@/services/workflowService'
import { resolveNodes } from '@/services/nodeService'
import type { NodeDefinition } from '@/types/node'
import type { ExecutorResolutionResult, OutputIncompleteReason } from '@/types/workflow'
import { useEventStream } from '@/services/eventService'
import { ApiError } from '@/services/api'
import { toast } from '@/stores/toastStore'
import type { ExecutionLog, ExecutionStatus } from '@/types/execution'
import { ArrowUpDown, ArrowLeftRight, Eye, LockKeyholeOpen, History, FoldVertical, UnfoldVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const nodeTypes = { glowNode: GlowNode, terminalNode: TerminalNode }
const edgeTypes = { gradientEdge: GradientEdge }

// 实测尺寸重排的防抖窗口：收缩/展开会让 ResizeObserver 在 300ms 过渡里连续上报
// 中间尺寸，等尺寸稳定再跑 ELK，避免中间态布局反复落地
const MEASURED_LAYOUT_DEBOUNCE_MS = 120

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

// 注入节点 data 的执行器徽章字段（图重建与增量到达都走这里，保持一致）
function executorFieldsFor(
  nodeId: string,
  info: ExecutorResolutionResult | null,
  incomplete: Record<string, OutputIncompleteReason>,
) {
  const executor = info?.nodes?.[nodeId]
  const executorInstance = executor?.executor ? info?.executors?.[executor.executor] : undefined
  return {
    executor,
    executorInstance,
    outputIncomplete: incomplete[nodeId],
  }
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
  // preview：只能平移画布、切换布局方向；edit：额外可拖动节点、编辑参数
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  // 解析 effect 不能依赖 mode（切换模式重跑 mermaid+dagre 会丢失手动拖动的位置），
  // 构建节点 data 时通过 ref 读当前模式；mode 变化由独立 effect 同步 data.interactive
  const modeRef = useRef(mode)
  modeRef.current = mode
  // 当前画布节点/边镜像：图解析回调是异步的，diff 增删节点时不能用渲染闭包快照
  const nodesRef = useRef<Node[]>([])
  const edgesRef = useRef<Edge[]>([])
  // 外部更新（workflow.updated SSE）回读最新流水线定义的防抖句柄
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 新增节点逐个入场期间为 true：暂停「实测尺寸重排」，避免部分图重排抖动
  const staggeringRef = useRef(false)
  // 实测尺寸重排的去重 key（不含位置，重排只改 position 不会循环）。
  // 语义是「**已经落地**的尺寸集合」，只有布局真正应用后才写入——详见实测重排 effect
  const layoutKeyRef = useRef('')
  // 请求一次实测重排的信号：入场/退场 stagger 动画期间实测重排被跳过，
  // 动画结束后靠它再触发一次（此时尺寸已稳定，不能只清 key 等状态变化）
  const [layoutEpoch, setLayoutEpoch] = useState(0)
  const { fitView } = useReactFlow()
  const [, setSelectedNode] = useState<string | null>(null)
  // 精确选择器订阅：避免 store 中无关字段变化触发整个画布重渲染
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow)
  const nodeStatuses = useWorkflowStore((s) => s.nodeStatuses)
  const nodeCompletedAt = useWorkflowStore((s) => s.nodeCompletedAt)
  const nodePrevCompletedAt = useWorkflowStore((s) => s.nodePrevCompletedAt)
  const nodeRuntimeData = useWorkflowStore((s) => s.nodeRuntimeData)
  const updateNodeStatus = useWorkflowStore((s) => s.updateNodeStatus)
  const setNodeRuntimeData = useWorkflowStore((s) => s.setNodeRuntimeData)
  // 顶栏一键收缩/展开所有节点：全局信号下发到各节点组件，尺寸变化触发实测重排
  const nodesCollapsed = useWorkflowStore((s) => s.nodesCollapsed)
  const setNodesCollapsed = useWorkflowStore((s) => s.setNodesCollapsed)
  // 画布引用的节点包定义：按 YAML 中的 nodeRef 集合批量 resolve（不拉全量列表），
  // key 为 YAML 原样 ref 字符串；nodeDefsTick 由节点变更 SSE 触发重取
  const [resolvedNodeDefs, setResolvedNodeDefs] = useState<Record<string, NodeDefinition | null>>({})
  const [nodeDefsTick, setNodeDefsTick] = useState(0)
  // 各节点最终跑在哪个执行器（画布徽章）：编辑态按定义实时解析、回放态用执行快照。
  // 同时用 ref 保存一份：图重新解析（重建节点）时读取最新值，避免徽章闪失
  const [executorInfo, setExecutorInfo] = useState<ExecutorResolutionResult | null>(null)
  const executorInfoRef = useRef<ExecutorResolutionResult | null>(null)
  const selectedExecutionId = useExecutionStore((s) => s.selectedExecutionId)
  const runningExecutionId = useExecutionStore((s) => s.runningExecutionId)
  const selectedExecutionYaml = useExecutionStore((s) => s.selectedExecutionYaml)
  // 顶部栏展示的执行 ID：仅随选中（回放）的执行出现——未选中任何执行时
  // 界面零痕迹，即使本端发起的运行仍在后台进行（运行按钮转圈已足够提示）
  const liveExecutionId = selectedExecutionId

  // 编辑态补充：拉最近一次成功执行的节点输出（metadata 扁平点键还原），
  // 经 data.lastOutputs 下发给 GlowNode，widget 的 paramSources.runtimeValue
  // 在无运行实例时也能解析（mask-paint 底图、绑上游地址的模型下拉等）。
  // 刻意不进 nodeRuntimeData store：避免编辑态「返回」区显示旧数据。
  const [lastRunOutputs, setLastRunOutputs] = useState<Record<string, Record<string, string>>>({})
  useEffect(() => {
    const wfId = currentWorkflow?.id
    if (mode !== 'edit' || !wfId) { setLastRunOutputs({}); return }
    let cancelled = false
    ;(async () => {
      try {
        const list = await getExecutions({ workflow_id: Number(wfId), status: 'success', page: 1, page_size: 1 })
        const latest = list.data?.items?.[0]
        if (!latest || cancelled) return
        const detail = await getExecution(String(latest.id))
        if (cancelled) return
        // metadata 可能是 JSON 字符串（API 直出）或已解析对象
        let meta: unknown = detail.data?.metadata
        if (typeof meta === 'string') { try { meta = JSON.parse(meta) } catch { meta = undefined } }
        const runtime = (((meta as Record<string, unknown> | undefined)?.metadata) ?? {}) as Record<string, unknown>
        const byNode: Record<string, Record<string, string>> = {}
        for (const [key, value] of Object.entries(runtime)) {
          const dot = key.indexOf('.')
          if (dot <= 0) continue
          const nodeId = key.slice(0, dot)
          const field = key.slice(dot + 1)
          if (!byNode[nodeId]) byNode[nodeId] = {}
          byNode[nodeId][field] = typeof value === 'string'
            ? value
            : (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)
              ? String((value as Record<string, unknown>).value)
              : JSON.stringify(value))
        }
        setLastRunOutputs(byNode)
      } catch { /* 装饰性数据，失败静默 */ }
    })()
    return () => { cancelled = true }
  }, [mode, currentWorkflow?.id, runningExecutionId])

  // 增量注入 lastOutputs（只改 data 保持 position 不变，避免丢失手动布局）
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const cur = n.data as Record<string, unknown>
        if (cur.lastOutputs === lastRunOutputs) return n
        return { ...n, data: { ...cur, lastOutputs: lastRunOutputs } }
      })
    )
  }, [lastRunOutputs, setNodes])

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
  // PUT 带乐观锁基线（baseRevision）：若流水线在本页编辑期间被他端（另一标签页/
  // 设备/CLI）修改，服务端返回 409——回读最新版本并提示，不再静默整量覆盖。
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
        baseRevision: latest.revision,
      })
    } catch (err) {
      console.error('Failed to persist node params:', err)
      if (err instanceof ApiError && err.status === 409) {
        // 他端已改：回读最新版同步本地，提示用户刚才的改动未保存
        try {
          const resp = await getWorkflow(String(latest.id))
          const cur = useWorkflowStore.getState().currentWorkflow
          if (resp.data && cur && String(resp.data.id) === String(cur.id)) {
            useWorkflowStore.getState().setCurrentWorkflow({ ...resp.data, id: String(resp.data.id) })
          }
        } catch (e) {
          console.error('Failed to refetch workflow after conflict:', e)
        }
        toast.error(t('canvas.paramsConflict'))
      } else {
        toast.error(t('canvas.paramsPersistFailed', { message: err instanceof Error ? err.message : String(err) }))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // 卸载前把挂起的防抖写回立即落库（fire-and-forget）：
      // 离开画布页时 800ms 窗口内的参数修改不能丢
      if (persistTimerRef.current && pendingParamsFlush) {
        pendingParamsFlush().catch(() => undefined)
      }
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      pendingParamsFlush = null
    }
  }, [])

  // 镜像当前画布节点/边，供图解析完成回调 diff 出增删节点
  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges])

  // 按 YAML 中的 nodeRef 集合批量 resolve 节点包定义（含 ui 配置）；
  // sourceYaml 变化（切换流水线/快照、参数写回）或节点包变更 SSE 时重取，
  // 保证重新导入（ui 尺寸/bundle 更新、版本升降）后能拿到最新定义
  useEffect(() => {
    if (!sourceYaml) {
      setResolvedNodeDefs({})
      return
    }
    const refs = [...new Set(Object.values(parseNodeRefs(sourceYaml)))]
    if (refs.length === 0) {
      setResolvedNodeDefs({})
      return
    }
    let cancelled = false
    resolveNodes(refs)
      .then((resp) => {
        if (cancelled || resp.code !== 200 || !resp.data) return
        const mapped: Record<string, NodeDefinition | null> = {}
        for (const [ref, def] of Object.entries(resp.data.items)) {
          // 后端返回的 id 是 number，前端类型是 string
          mapped[ref] = def ? { ...def, id: String(def.id) } : null
        }
        setResolvedNodeDefs(mapped)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sourceYaml, nodeDefsTick])

  // 解析 YAML Graph 并渲染工作流
  useEffect(() => {
    if (!sourceYaml) {
      setNodes([])
      setEdges([])
      return
    }

    // 节点实例 ID → 节点包名 → 节点包定义（含 ui 配置）
    const nodeRefs = parseNodeRefs(sourceYaml)
    // 节点实例 ID → 显示名（YAML Nodes.<id>.name），画布节点名称优先用它展示
    const nodeNames = parseNodeNames(sourceYaml)
    // 节点实例 ID → 当前参数绑定（config.params），下发给节点自定义 UI 组件
    const nodeParams = parseNodeParams(sourceYaml)
    // 节点实例 ID → 参数绑定来源（流水线参数/上游节点/字面值），供 UI 组件渲染来源标注
    const paramSources = parseParamSources(sourceYaml)
    // 节点实例 ID → 节点包定义（含 ui 配置）：按批量 resolve 结果直接索引，
    // 后端语义：name@version 精确匹配；裸名解析到最新版本；
    // 锁定版本已删除时回退同名最新版本。未命中的 ref 为 null
    const matchNodeDef = (instanceId: string) => {
      const ref = nodeRefs[instanceId]
      if (!ref) return undefined
      return resolvedNodeDefs[ref] ?? undefined
    }

    // 过期取消：首次进入时 mermaid 动态加载较慢，若节点定义在此期间加载完成
    // 触发了新一轮解析，旧的慢解析结果不得覆盖新结果（否则子 UI 首次不显示）
    let cancelled = false
    // 新增节点逐个入场的延迟定时器，effect 清理时一并取消
    const staggerTimers: ReturnType<typeof setTimeout>[] = []

    parseWorkflowGraph(sourceYaml)
      .then(async ({ nodes: parsedNodes, edges: parsedEdges }) => {
        // 本次重建的位置全部来自估算尺寸（rawNodes 是全新对象，没有 measured，
        // AutoLayout 只能按 ui 配置占位），此前那次「按实测尺寸重排」的去重 key
        // 随之失效：若不清空，重建后实测尺寸与上一份恰好相同时（折叠态切换
        // 模板/执行快照时尺寸不变是常态）会被去重命中而跳过重排，画布就永久停在
        // 估算尺寸（展开态量级）的大间距上，且再也不会自愈
        layoutKeyRef.current = ''
        // 状态读取必须取解析完成时刻的最新值（getState），不能用 effect 闭包快照：
        // mermaid 解析是异步的，期间 selectExecutionAndSync 可能已把执行状态
        // 同步进 store（选中/清除历史执行），用闭包快照重建节点会把刚同步的
        // 状态用旧值覆盖（出现「选中显示 idle、清除反而显示 success」的反转）
        const {
          nodeStatuses: curStatuses,
          nodeCompletedAt: curCompletedAt,
          nodePrevCompletedAt: curPrevCompletedAt,
          nodeRuntimeData: curRuntimeData,
        } = useWorkflowStore.getState()
        // 解析完成时刻的最新值：执行器归属与"输出可能不完整"标记
        const curExecutorInfo = executorInfoRef.current
        const curIncomplete = incompleteRef.current

        const rawNodes: Node[] = parsedNodes.map((n) => {
          const nodeDef = n.id === '__start__' || n.id === '__end__' ? undefined : matchNodeDef(n.id)
          return {
            id: n.id,
            type: n.id === '__start__' || n.id === '__end__' ? 'terminalNode' : 'glowNode',
            position: { x: 0, y: 0 },
            data: {
              id: n.id,
              name: nodeNames[n.id] || n.label,
              status: curStatuses[n.id] || 'idle',
              accentColor: nodeDef?.ui ? '#a855f7' : '#6366f1',
              icon: nodeDef?.icon,
              inputs: curRuntimeData[n.id]?.inputs,
              outputs: curRuntimeData[n.id]?.outputs,
              direction,
              nodeRef: nodeDef?.name,
              nodeDbId: nodeDef?.id,
              nodeUpdatedAt: nodeDef?.updatedAt ? String(nodeDef.updatedAt) : undefined,
              ui: nodeDef?.ui,
              params: nodeParams[n.id],
              paramSources: paramSources[n.id],
              ...executorFieldsFor(n.id, curExecutorInfo, curIncomplete),
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

        const { nodes: layoutedNodes, edges: layoutedEdges } = await autoLayout(rawNodes, rawEdges, { direction })
        if (cancelled) return
        // 与当前画布 diff：后台（CLI/API）更新带来的新增节点逐个延迟挂载，
        // 配合节点组件的入场弹簧动画形成依次出现的丝滑效果；
        // 被删节点打 leaving 标记播缩小淡出动画后再移除；
        // 已有节点原地更新数据/位置，不重复播入场动画
        const prevIds = new Set(nodesRef.current.map((n) => n.id))
        const layoutedIds = new Set(layoutedNodes.map((n) => n.id))
        const addedNodes = layoutedNodes.filter((n) => !prevIds.has(n.id))
        const removedNodes = nodesRef.current.filter((n) => !layoutedIds.has(n.id))
        // 非起止节点有交集才算「同一幅图的增量更新」；切换流水线/执行时
        // 整图节点都是新的，逐个入场会拖慢首屏，直接全量设置
        const isTerminalId = (id: string) => id === '__start__' || id === '__end__'
        const hasOverlap = layoutedNodes.some((n) => !isTerminalId(n.id) && prevIds.has(n.id))

        if (prevIds.size === 0 || !hasOverlap || (addedNodes.length === 0 && removedNodes.length === 0)) {
          // 首次加载/整图切换/无增删：全量设置
          setNodes(layoutedNodes)
          setEdges(layoutedEdges)
          return
        }

        const addedIds = new Set(addedNodes.map((n) => n.id))
        // 已挂载节点集合：边在两端节点都出现后才随之出现
        const available = new Set(prevIds)
        staggeringRef.current = true

        // 逐个删除：按链尾→链头倒序，每个节点间隔 400ms 播缩小淡出，动画结束再移除；
        // 连向被删节点的旧边改 id（leaving-*）暂时保留，随该节点开始淡出时撤掉
        const removedIds = new Set(removedNodes.map((n) => n.id))
        const leavingQueue = [...removedNodes].reverse()
        const leavingEdges = edgesRef.current
          .filter((e) => removedIds.has(e.source) || removedIds.has(e.target))
          .map((e) => ({ ...e, id: `leaving-${e.id}`, data: { ...e.data, animated: false } }))

        setNodes([...layoutedNodes.filter((n) => !addedIds.has(n.id)), ...removedNodes])
        // layoutedEdges 已不含连向被删节点的边（图解析结果），补上 leavingEdges 过渡
        setEdges([
          ...layoutedEdges.filter((e) => !addedIds.has(e.source) && !addedIds.has(e.target)),
          ...leavingEdges,
        ])

        leavingQueue.forEach((node, i) => {
          const start = i * 400
          // 开始淡出：打 leaving 标记（组件播 0.3s 缩小淡出），同时撤掉连向它的边
          staggerTimers.push(
            setTimeout(() => {
              if (cancelled) return
              available.delete(node.id)
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === node.id
                    ? {
                        ...n,
                        draggable: false,
                        selectable: false,
                        data: { ...n.data, leaving: true, interactive: false },
                      }
                    : n,
                ),
              )
              setEdges((eds) =>
                eds.filter(
                  (e) =>
                    !e.id.startsWith('leaving-') || (e.source !== node.id && e.target !== node.id),
                ),
              )
            }, start),
          )
          // 淡出动画结束后真正移除节点
          staggerTimers.push(
            setTimeout(() => {
              if (cancelled) return
              setNodes((nds) => nds.filter((n) => n.id !== node.id))
            }, start + 320),
          )
        })

        addedNodes.forEach((node, i) => {
          // 超过 10 个新增时后续节点共享最后一个延迟槽位，避免大批量更新拖太久
          const slot = Math.min(i, 9)
          staggerTimers.push(
            setTimeout(() => {
              if (cancelled) return
              available.add(node.id)
              setNodes((nds) => (nds.some((n) => n.id === node.id) ? nds : [...nds, node]))
              setEdges((eds) => {
                const existing = new Set(eds.map((e) => e.id))
                const toAdd = layoutedEdges.filter(
                  (e) => available.has(e.source) && available.has(e.target) && !existing.has(e.id),
                )
                return toAdd.length ? [...eds, ...toAdd] : eds
              })
            }, 150 + slot * 400),
          )
        })
        // 全部出现后恢复实测重排并平滑缩放视野，保证新节点进入可视区
        const lastAddDelay = addedNodes.length > 0 ? 150 + Math.min(addedNodes.length - 1, 9) * 400 : 0
        const lastRemoveDone = leavingQueue.length > 0 ? (leavingQueue.length - 1) * 400 + 320 : 0
        staggerTimers.push(
          setTimeout(() => {
            if (cancelled) return
            staggeringRef.current = false
            // stagger 期间跳过了实测尺寸重排，这里必须补一次：否则整图会停在本轮
            // 重建时的**估算尺寸**布局上（新节点尺寸没参与排布，节点挤在一起），
            // 只有手动收缩再展开改变尺寸 key 才会自愈
            layoutKeyRef.current = ''
            setLayoutEpoch((e) => e + 1)
            // 实测重排是防抖异步的，等它落地后再取景，避免按旧位置取景
            staggerTimers.push(
              setTimeout(() => {
                if (cancelled) return
                fitView({ padding: 0.08, duration: 500 })
              }, 360),
            )
          }, Math.max(lastAddDelay + 500, lastRemoveDone > 0 ? lastRemoveDone + 400 : 0)),
        )
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to parse workflow graph:', err)
        setNodes([])
        setEdges([])
      })

    return () => {
      cancelled = true
      staggeringRef.current = false
      staggerTimers.forEach(clearTimeout)
    }
  }, [sourceYaml, direction, resolvedNodeDefs, paramsEditable, handleNodeParamsChange, setNodes, setEdges])

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
  // 尺寸会变化（React Flow 自动测量到 node.measured），此处检测到变化后重跑 ELK，
  // 避免节点重叠。key 不含位置，重排只改 position 不改变 measured，因此不会循环。
  // 新增节点逐个入场期间跳过：此时画布是部分图，重排会让已有节点位置抖动。
  //
  // 去重 key 只在布局**应用成功**后记账：早期版本在调度前就写入 key，于是
  // 状态同步/连线更新/参数注入等任意 setNodes/setEdges 引发的 effect 重跑会命中
  // 同一 key 提前 return，同时 cleanup 把那轮还在飞的布局置为 cancelled——两个
  // 都落不了地，画布就永久停在上一次（估算尺寸）的位置上，节点看起来挤成一团，
  // 直到手动收缩再展开改变实测尺寸 key 才自愈。
  useEffect(() => {
    if (staggeringRef.current) return
    if (nodes.length === 0) return
    if (!nodes.every((n) => n.measured?.width && n.measured?.height)) return
    const key =
      direction +
      '|' +
      nodes
        .map((n) => `${n.id}:${Math.round(n.measured!.width!)}x${Math.round(n.measured!.height!)}`)
        .join('|')
    if (key === layoutKeyRef.current) return

    let cancelled = false
    // 收缩/展开是 300ms 的 CSS 过渡，ResizeObserver 期间会上报一长串中间尺寸；
    // 防抖到尺寸稳定后再跑 ELK，避免中间态布局反复抢占最终布局
    const timer = setTimeout(() => {
      autoLayout(nodes, edges, { direction })
        .then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
          if (cancelled) return
          layoutKeyRef.current = key
          setNodes(layoutedNodes)
          setEdges(layoutedEdges)
        })
        .catch((err) => {
          if (cancelled) return
          console.error('Failed to run ELK layout:', err)
        })
    }, MEASURED_LAYOUT_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [nodes, edges, direction, layoutEpoch, setNodes, setEdges])

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
      eds.map((edge) => {
        const animated = isEdgeActive(edge, nodeStatuses, nodeCompletedAt, nodePrevCompletedAt)
        return {
          ...edge,
          // 复杂图中若绕行后仍有轻微交叉，执行中的路径优先保持在节点上方
          zIndex: animated ? 10 : 0,
          data: {
            ...edge.data,
            animated,
            traversed: isEdgeTraversed(edge.source, edge.target, nodeStatuses, nodeCompletedAt),
            status: nodeStatuses[edge.target] === 'failed' ? 'failed' : 'normal',
          },
        }
      })
    )
  }, [nodeStatuses, nodeCompletedAt, nodePrevCompletedAt, setNodes, setEdges])

  // 同步节点运行时数据（入参/返回/实时预览）：退出回放态时 nodeRuntimeData 清空，
  // 此处同步清掉节点上残留的 inputs/outputs/preview，不能 early-return
  useEffect(() => {
    setNodes((nds) => {
      let changed = false
      const next = nds.map((node) => {
        const runtime = nodeRuntimeData[node.id]
        const inputs = runtime?.inputs
        const outputs = runtime?.outputs
        const preview = runtime?.preview
        const media = runtime?.media

        // 引用未变直接跳过：一次更新中大多数节点没有变化
        if (
          inputs === node.data.inputs &&
          outputs === node.data.outputs &&
          preview === node.data.preview &&
          media === node.data.media
        ) {
          return node
        }

        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            inputs,
            outputs,
            preview,
            media,
          },
        }
      })
      // 全部节点引用未变：返回原数组（同引用），避免 setNodes 触发新渲染与本 effect 互循环
      return changed ? next : nds
    })
    // nodes 加入依赖：选中执行后画布会被「执行快照」整套重建（node.data 运行时字段被重置），
    // 必须在重建后把 nodeRuntimeData 已恢复的 inputs/outputs/preview 重新摆回画布——否则
    // 历史回放的预览帧会被重建冲掉（outputs 因在重建时机播种而幸免）。无变化时返回原数组
    // 引用，不会与 setNodes 形成无限循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeRuntimeData, nodes, setNodes])

  const selectedExecution = useExecutionStore((s) => s.selectedExecution)

  // 执行器归属查询：编辑态按当前定义解析（与运行链路同一事实源），
  // 回放态带 executionId 用执行快照解析（不随后续修改漂移）。
  // 失败只影响徽章显示，不阻塞画布
  const replayMode = !!(selectedExecutionId && selectedExecutionYaml)
  useEffect(() => {
    const wfId = currentWorkflow?.id
    if (!wfId || !sourceYaml) {
      executorInfoRef.current = null
      setExecutorInfo(null)
      return
    }
    let cancelled = false
    getWorkflowExecutors(String(wfId), replayMode ? String(selectedExecutionId) : undefined)
      .then((resp) => {
        if (cancelled) return
        const data = resp.code === 200 ? resp.data ?? null : null
        executorInfoRef.current = data
        setExecutorInfo(data)
      })
      .catch(() => {
        if (cancelled) return
        executorInfoRef.current = null
        setExecutorInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [currentWorkflow?.id, sourceYaml, replayMode, selectedExecutionId, nodeDefsTick])

  // 「输出可能不完整」标记：flowx 在执行器流被截断 / 声明 extract 却零提取时写入
  // <node>.__stream_truncated / <node>.__extract_missing，随 node_complete 事件合并进
  // 执行 metadata（键为扁平点键），这里还原成按节点的提示。
  const incompleteByNode = useMemo(() => {
    const out: Record<string, OutputIncompleteReason> = {}
    const meta = selectedExecution?.metadata as Record<string, unknown> | undefined
    const runtime = (meta?.metadata ?? {}) as Record<string, unknown>
    const isTrue = (value: unknown) => {
      if (value === true || value === 'true') return true
      if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
        return String((value as Record<string, unknown>).value) === 'true'
      }
      return false
    }
    for (const [key, value] of Object.entries(runtime)) {
      const dot = key.indexOf('.')
      if (dot <= 0 || !isTrue(value)) continue
      const nodeId = key.slice(0, dot)
      const field = key.slice(dot + 1)
      if (field === '__stream_truncated') out[nodeId] = 'stream-truncated'
      else if (field === '__extract_missing') out[nodeId] = 'extract-missing'
    }
    return out
  }, [selectedExecution])
  const incompleteRef = useRef<Record<string, OutputIncompleteReason>>({})
  incompleteRef.current = incompleteByNode

  // 增量注入徽章与提示（执行器查询/metadata 晚于图解析到达时生效），
  // 只改 data 保持 position 不变，避免丢失手动布局
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const next = executorFieldsFor(n.id, executorInfo, incompleteByNode)
        const cur = n.data as Record<string, unknown>
        if (cur.executor === next.executor && cur.outputIncomplete === next.outputIncomplete) return n
        return { ...n, data: { ...cur, ...next } }
      })
    )
  }, [executorInfo, incompleteByNode, setNodes])

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

  // 恢复节点预览（路线 A）：刷新页面/切换执行后拉媒体产物清单，把 kind=frame 的
  // 最新一份还原为 preview（物化缓存在磁盘，Studio 重启/第三方断网后仍可供给）；
  // 其余 kind（如 kind=input 的输入原图）回到 media 映射，供 widget 对比区使用。
  // 执行中的实时帧仍由 SSE node_preview 事件覆盖
  useEffect(() => {
    if (!selectedExecutionId) return
    let cancelled = false
    getExecutionMedia(String(selectedExecutionId))
      .then((resp) => {
        if (cancelled) return
        const items = resp.data?.media || []
        type Item = { path: string; updatedAt: string }
        const latestFrame: Record<string, Item> = {}
        const latestByKind: Record<string, Record<string, Item>> = {}
        for (const it of items) {
          const at = new Date(it.updatedAt).getTime()
          const kindMap = (latestByKind[it.nodeId] = latestByKind[it.nodeId] || {})
          const prevKind = kindMap[it.kind]
          if (!prevKind || at > new Date(prevKind.updatedAt).getTime()) {
            kindMap[it.kind] = { path: it.path, updatedAt: it.updatedAt }
          }
          if (it.kind !== 'frame') continue
          const cur = latestFrame[it.nodeId]
          if (!cur || at > new Date(cur.updatedAt).getTime()) {
            latestFrame[it.nodeId] = { path: it.path, updatedAt: it.updatedAt }
          }
        }
        for (const [nodeId, it] of Object.entries(latestFrame)) {
          setNodeRuntimeData(nodeId, {
            preview: {
              url: `/api/v1/media/file?path=${encodeURIComponent(it.path)}&t=${new Date(it.updatedAt).getTime()}`,
            },
          })
        }
        for (const [nodeId, kindMap] of Object.entries(latestByKind)) {
          const media: Record<string, string> = {}
          for (const [kind, it] of Object.entries(kindMap)) {
            media[kind] = `/api/v1/media/file?path=${encodeURIComponent(it.path)}&t=${new Date(it.updatedAt).getTime()}`
          }
          setNodeRuntimeData(nodeId, { media })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [selectedExecutionId, setNodeRuntimeData])

  // 订阅 SSE 事件
  // 注意：/api/v1/events 是**全局流**——所有流水线的执行事件都推过来（无 workflow 过滤）。
  // 执行/节点/预览类事件必须先用它圈定「本画布正在展示的那个执行」，否则别的流水线的
  // 运行会改写本画布：事故现场 = 选中运行中的执行（回放态），几分钟后别的流水线开始
  // （execution.started）→ selectExecution(别人的 id) → 页面的「选中执行不属于本
  // 流水线 ⇒ 退出回放态」 effect 立即生效，看起来就是「选中过一会自己取消了」；
  // 同理别人完成时的 stopExecution() 会把本端的运行态一起清掉，别人的 node_start
  // 还会因节点 id 跨流水线重名（Save/MaskPaint…）把本画布的节点点亮。
  //
  // 回读当前工作流最新定义（乐观锁回声跳过：revision 是内容哈希，一致即未变；
  // 老服务端不下发 revision 时回退比较 yamlConfig）。调用前先把本地挂起的
  // 参数写回冲刷落库，避免回读到未含本地编辑的旧版本覆盖内存状态。
  const refreshCurrentWorkflow = useCallback(async () => {
    const wf = useWorkflowStore.getState().currentWorkflow
    if (!wf) return
    await flushNodeParamsPersist()
    const resp = await getWorkflow(String(wf.id))
    const latest = useWorkflowStore.getState().currentWorkflow
    if (!resp.data || !latest || String(resp.data.id) !== String(latest.id)) return
    const unchanged = resp.data.revision
      ? resp.data.revision === latest.revision
      : resp.data.yamlConfig === latest.yamlConfig
    if (unchanged) return
    useWorkflowStore.getState().setCurrentWorkflow({ ...resp.data, id: String(resp.data.id) })
  }, [])

  // 判定规则（执行间严格隔离，用户确认的语义）：
  // - eventAppliesToCanvas（视觉/日志数据）：只认「回放态选中的」那个执行。
  //   未选中任何执行时画布绝对干净——即使本端发起的运行还在后台跑，其节点事件、
  //   预览帧、输出、日志一律不进画布与日志面板；选中历史执行 A 时，正在跑的 B
  //   同样不得串进来。
  // - eventAppliesToRun（生命周期管理）：认「选中的」或「本页正在运行的」。
  //   只用于更新执行列表状态与停跑标记（不停跑 isExecuting 会卡死、运行按钮
  //   永远禁用），不直接渲染画布，故不受「未选中零痕迹」约束。
  const eventAppliesToCanvas = (payload: {
    execution_id?: unknown
    executionId?: unknown
  }) => {
    const rawId = payload?.execution_id ?? payload?.executionId
    if (rawId === undefined || rawId === null) return false
    const s = useExecutionStore.getState()
    return String(rawId) === s.selectedExecutionId
  }
  const eventAppliesToRun = (payload: {
    execution_id?: unknown
    executionId?: unknown
  }) => {
    const rawId = payload?.execution_id ?? payload?.executionId
    if (rawId === undefined || rawId === null) return false
    const s = useExecutionStore.getState()
    const id = String(rawId)
    return id === s.runningExecutionId || id === s.selectedExecutionId
  }
  useEventStream('/api/v1/events', (type, data) => {
    if (type === 'workflow.updated') {
      // 后台（CLI/API/他端页面）更新了当前流水线：防抖回读最新定义，驱动画布增量刷新。
      // 注意 currentWorkflow.id 运行时可能是 number（列表页点击直接存入原始 API 项），
      // 比较前统一转字符串
      const payload = data as { id?: number | string }
      const wf = useWorkflowStore.getState().currentWorkflow
      if (!wf || payload.id === undefined || String(payload.id) !== String(wf.id)) return
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        refreshCurrentWorkflow().catch((err) =>
          console.error('Failed to refresh workflow after external update:', err)
        )
      }, 250)
      return
    }

    if (type === 'node.created' || type === 'node.updated' || type === 'node.deleted') {
      // 节点包后台变更（import/update/delete）：重取画布引用到的节点定义，
      // 按 nodeRef 重新匹配 ui 配置与版本
      setNodeDefsTick((t) => t + 1)
      return
    }

    // 新执行开始：**故意什么都不做**。本端点运行后的「自动进入该执行回放态」
    // 由页面 handleRun 依接口返回的 execution_id 本地完成（见 WorkflowCanvasPage），
    // 不依赖这个全局事件——否则他端（CLI/另一台设备）一齐跑，编辑态画布就会被
    // 拽进别人的回放态，或平白多出一身运行特效
    if (type === 'execution.started') {
      return
    }

    if (type === 'execution.updated') {
      // 快照被外部更新（CLI continue --no-run）：仅改图不执行。
      // 若当前正选中该执行，刷新快照与节点记录——新增节点以 idle 入场动画出现，
      // 状态不变（没有运行）
      const payload = data as { execution_id?: number }
      if (payload.execution_id) {
        const id = String(payload.execution_id)
        const execStore = useExecutionStore.getState()
        if (execStore.selectedExecutionId === id) {
          void execStore
            .refreshExecutionContext(id)
            .then(() => syncCanvasStatusesFromExecutionNodes())
        }
      }
      return
    }

    if (type === 'execution_start') {
      const payload = data as {
        execution_id?: number
        params?: Record<string, unknown>
      }
      if (payload.execution_id) {
        const id = String(payload.execution_id)
        // 别的流水线的续跑与本画布无关（否则会污染 executions 列表与运行态）
        if (!eventAppliesToRun(payload)) return
        useExecutionStore.getState().updateExecutionMetadata(id, {
          status: 'running',
          params: payload.params || {},
        })
        // 续跑（CLI/API 的 continue）不产生 execution.started 事件：若当前正选中
        // 该执行（回放态），主动刷新上下文——续跑可能已向快照追加节点，不刷新
        // 画布仍按旧快照渲染，新增节点不显示也无动画（此前需手动刷新页面）。
        // isExecuting 为 true 说明是本端发起的运行/续跑（execution.started 或
        // beginContinue 已处理），跳过避免重复拉取
        const execStore = useExecutionStore.getState()
        if (execStore.selectedExecutionId === id && !execStore.isExecuting) {
          execStore.beginContinue(id)
          void execStore
            .refreshExecutionContext(id)
            .then(() => syncCanvasStatusesFromExecutionNodes())
        }
      }
      return
    }

    if (type === 'execution_paused') {
      const payload = data as { execution_id?: number }
      if (eventAppliesToRun(payload)) {
        useExecutionStore.getState().updateExecutionStatus(String(payload.execution_id), 'paused')
      }
      return
    }

    if (type === 'execution_resumed') {
      const payload = data as { execution_id?: number }
      if (eventAppliesToRun(payload)) {
        useExecutionStore.getState().updateExecutionStatus(String(payload.execution_id), 'running')
      }
      return
    }

    if (type === 'execution_cancelled') {
      const payload = data as { execution_id?: number }
      if (eventAppliesToRun(payload)) {
        const id = String(payload.execution_id)
        useExecutionStore.getState().updateExecutionStatus(id, 'cancelled')
        // 取消后运行中节点被终止：后端已将 running 节点落库 cancelled，
        // 重新拉取节点状态并同步画布，避免残留黄灯。
        // 仅当前正选中该执行才动画布——未选中时画布必须零痕迹
        if (useExecutionStore.getState().selectedExecutionId === id) {
          void useExecutionStore.getState().loadExecutionNodes(id).then(() => syncCanvasStatusesFromExecutionNodes())
        }
      }
      return
    }

    if (type === 'node_start') {
      const payload = data as { execution_id?: number; node_id?: string }
      // 节点 id 跨流水线重名（Save/MaskPaint …）：不过滤的话别人跑的节点
      // 会把本画布的节点点亮成 running
      if (payload.node_id && eventAppliesToCanvas(payload)) {
        updateNodeStatus(payload.node_id, 'running')
      }
      return
    }

    if (type === 'node_preview') {
      // 节点上报的媒体产物事件（路线 A 媒体通道统一化）：payload.path 是 Studio
      // 物化后的磁盘路径 → 用通用 media 出口直读（刷新/重启/第三方断网仍可供给
      // 最后一帧）。preview-frame 专用接口已删除：物化完成的事件带 path → 更新帧地址；
      // 物化中的纯进度事件（无 path）保留上一帧 url 只更新进度。
      const payload = data as {
        execution_id?: number
        node_id?: string
        progress?: number
        job_id?: string
        path?: string
        kind?: string
      }
      if (!payload.node_id || !eventAppliesToCanvas(payload)) return
      // 按 kind 分流：只有 frame（含缺省，兼容旧节点）驱动画布预览帧；其它 kind
      //（如节点执行时物化的输入原图 kind=input）存进 media 映射——否则输入原图会把
      // 过程帧顶掉（widget 的对比区靠 media.input 拿原图，见 compareInput 区）。
      const kind = payload.kind || 'frame'
      if (kind !== 'frame') {
        if (!payload.path) return
        const mediaUrl = `/api/v1/media/file?path=${encodeURIComponent(payload.path)}&t=${Date.now()}`
        const prevMedia = useWorkflowStore.getState().nodeRuntimeData[payload.node_id]?.media
        setNodeRuntimeData(payload.node_id, {
          media: { ...(prevMedia || {}), [kind]: mediaUrl },
        })
        return
      }
      const existing = useWorkflowStore.getState().nodeRuntimeData[payload.node_id]?.preview
      const url = payload.path
        ? `/api/v1/media/file?path=${encodeURIComponent(payload.path)}&t=${Date.now()}`
        : existing?.url
      if (!url) {
        // 还没有任何帧（物化未完成）：仅刷新进度条，等带 path 的事件补上帧地址
        if (existing) {
          setNodeRuntimeData(payload.node_id, { preview: { ...existing, progress: payload.progress } })
        }
        return
      }
      setNodeRuntimeData(payload.node_id, {
        preview: {
          url,
          progress: payload.progress,
          jobId: payload.job_id || undefined,
        },
      })
      return
    }

    if (type === 'node_complete') {
      const payload = data as {
        execution_id?: number
        node_id?: string
        status?: string
        // 后端 persistRuntimeEvent 会把事件 Data 展开到顶层，outputs 与 node_id 平级
        outputs?: Record<string, unknown>
      }
      if (payload.node_id && eventAppliesToCanvas(payload)) {
        updateNodeStatus(payload.node_id, statusMap[payload.status || ''] || 'idle')
        // 节点终结后保留最后一帧预览：帧源（推理服务帧缓冲 1h TTL）与 Studio
        // 来源映射（2h TTL）在执行结束后仍可拉取，最后一次上报的 url 保持有效，
        // 画布继续展示该帧（进度条由组件在终态自行隐藏）；帧过期后由组件的
        // img onerror 回退占位。新一轮 node_preview/切换执行会覆盖或清空
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
        if (eventAppliesToCanvas(payload)) {
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
        } else {
          // 严格隔离：日志不属于「正在展示的执行」一律丢弃。例外记账——若是本端
          // 正在运行（但未被选中）的执行，标记日志缺口：重新选中它时 selectExecution
          // 会依此从 DB 重载补齐（否则 live 执行跳过重载，缺口永远补不上）
          const s = useExecutionStore.getState()
          const id = String(payload.execution_id)
          if (id === s.runningExecutionId) s.markLiveLogGap(id)
        }
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
      // 别的流水线的收尾事件不得停掉本端的运行态（stopExecution 是全局的）
      if (payload.execution_id && eventAppliesToRun(payload)) {
        const id = String(payload.execution_id)
        useExecutionStore.getState().updateExecutionMetadata(id, {
          status: (payload.status || 'success').toLowerCase(),
          params: payload.params || {},
          metadata: payload.metadata || {},
        })
        // 同步顶层执行状态：续跑不走 execution.completed（点事件），仅靠本事件收尾，
        // 不更新的话 selectedExecution.status 会一直停在 running，顶部暂停按钮残留
        useExecutionStore
          .getState()
          .updateExecutionStatus(
            id,
            (payload.status || 'success').toLowerCase() as ExecutionStatus['status'],
          )
        // 续跑（continue）不产生 execution.completed 事件，此处兜底结束运行态；
        // 普通运行该调用幂等（随后的 execution.completed 会重复设置，无副作用）
        if (useExecutionStore.getState().runningExecutionId === id) {
          useExecutionStore.getState().stopExecution()
        }
      }
      return
    }

    if (type === 'execution.completed') {
      const payload = data as { execution_id?: number; status?: string }
      if (eventAppliesToRun(payload)) {
        const id = String(payload.execution_id)
        if (useExecutionStore.getState().runningExecutionId === id) {
          useExecutionStore.getState().stopExecution()
        }
        useExecutionStore.getState().updateExecutionStatus(
          id,
          (payload.status as ExecutionStatus['status']) || 'success'
        )
        // 仅当前正选中该执行才重载刷新终态（节点/日志/metadata 落库后的最终态）；
        // 未选中时不得把画布拽进回放态——用户可能正刻意留在编辑态（零痕迹）
        if (useExecutionStore.getState().selectedExecutionId === id) {
          useExecutionStore.getState().selectExecution(id)
        }
      }
    }
  }, () => {
    // SSE 断线重连：断线期间错过的 workflow.updated 不会补发，
    // 重连后主动回读一次当前工作流，避免页面长期持有旧定义
    refreshCurrentWorkflow().catch((err) =>
      console.error('Failed to resync workflow after SSE reconnect:', err)
    )
  })

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id)
  }, [])

  const isMobile = useIsMobile()

  // 一键收缩/展开所有节点：实测尺寸重排是异步的（内容变化 → ResizeObserver →
  // dimension change → dagre 重排），延迟 fitView 等重排落定后再适配视野
  const handleToggleAllNodes = useCallback(() => {
    setNodesCollapsed(!nodesCollapsed)
    setTimeout(() => fitView({ padding: isMobile ? 0.05 : 0.08, duration: 500 }), 450)
  }, [nodesCollapsed, setNodesCollapsed, fitView, isMobile])

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
        fitViewOptions={{ padding: isMobile ? 0.05 : 0.08 }}
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

        {/* 小地图：桌面/移动端均显示；移动端抬高避开底部 Tab 栏 */}
        <MiniMap
          className={`!bg-white/5 !border-white/10 !rounded-xl !backdrop-blur-xl
                     ${isMobile ? '!mb-14 !mr-2' : ''}`}
          style={{ width: isMobile ? 144 : 200, height: isMobile ? 104 : 150 }}
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
          maskStrokeColor="rgba(34,211,238,0.85)"
          maskStrokeWidth={isMobile ? 2 : 1.5}
          pannable
          zoomable={false}
        />

      </ReactFlow>

      {/* 顶部工具栏：流水线名称/ID + 当前执行 ID + 运行控制按钮。
          不再使用浮动画布上的圆角胶囊（Panel），改为固定顶栏。
          控件全部出现时（运行中：运行/暂停/终止 + 历史 + 模式 + 方向）
          宽度可能不足，内层容器支持横向滑动，避免控件互相重叠 */}
      <div
        className={`absolute top-0 inset-x-0 z-10
                    border-b border-white/10 bg-panel/80 backdrop-blur-2xl
                    ${isMobile ? 'h-11' : 'h-12'}`}
      >
        <div
          className={`flex items-center gap-2 h-full overflow-x-auto overflow-y-hidden
                      scrollbar-hide ${isMobile ? 'px-2' : 'px-4'}`}
        >
        {/* 左侧：流水线名称 + 流水线 ID + 当前执行 ID */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={`text-white/80 font-medium truncate ${
              isMobile ? 'text-xs max-w-[120px]' : 'text-sm max-w-[240px]'
            }`}
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

        {/* 右侧：运行/暂停按钮（action）+ 历史执行 + 预览/编辑切换 + 方向切换。
            ml-auto：宽度充足时贴右；不足时随整栏横向滑动 */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
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
          onClick={handleToggleAllNodes}
          className={`p-1.5 rounded-md flex-shrink-0 transition-colors ${
            nodesCollapsed
              ? 'text-cyan-300 bg-cyan-400/15 hover:bg-cyan-400/25'
              : 'text-white/60 hover:text-white/80 hover:bg-white/10'
          }`}
          title={nodesCollapsed ? t('canvas.expandAllNodes') : t('canvas.collapseAllNodes')}
        >
          {nodesCollapsed ? (
            <UnfoldVertical className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          ) : (
            <FoldVertical className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          )}
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
            <LockKeyholeOpen className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          )}
        </button>
        <button
          onClick={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))}
          className="p-1.5 rounded-md flex-shrink-0 transition-colors
                     text-white/60 hover:text-white/80 hover:bg-white/10"
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
