import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  Panel,
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
import { parseWorkflowGraph, parseNodeRefs } from '@/utils/mermaidParser'
import { useEventStream } from '@/services/eventService'
import type { ExecutionLog, ExecutionStatus } from '@/types/execution'
import { ArrowUpDown, ArrowLeftRight } from 'lucide-react'

const nodeTypes = { glowNode: GlowNode, terminalNode: TerminalNode }
const edgeTypes = { gradientEdge: GradientEdge }

const statusMap: Record<string, string> = {
  running: 'running',
  success: 'success',
  failed: 'failed',
}

function WorkflowCanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [direction, setDirection] = useState<'TB' | 'LR'>('TB')
  const [, setSelectedNode] = useState<string | null>(null)
  const {
    currentWorkflow,
    nodeStatuses,
    nodeRuntimeData,
    updateNodeStatus,
    setNodeStatuses,
    setNodeRuntimeData,
    resetNodeRuntimeData,
  } = useWorkflowStore()
  const { nodes: nodeDefs, loadNodes } = useNodeStore()

  // 节点包列表用于按 nodeRef 匹配 ui 配置；每次进入画布都刷新，
  // 保证节点重新导入（ui 尺寸/bundle 更新）后能拿到最新定义
  useEffect(() => {
    loadNodes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 解析 YAML Graph 并渲染工作流
  useEffect(() => {
    if (!currentWorkflow?.yamlConfig) {
      setNodes([])
      setEdges([])
      return
    }

    // 节点实例 ID → 节点包名 → 节点包定义（含 ui 配置）
    const nodeRefs = parseNodeRefs(currentWorkflow.yamlConfig)
    const matchNodeDef = (instanceId: string) => {
      const ref = nodeRefs[instanceId]
      if (!ref) return undefined
      return nodeDefs.find((n) => n.name === ref)
    }

    // 过期取消：首次进入时 mermaid 动态加载较慢，若 nodeDefs 在此期间加载完成
    // 触发了新一轮解析，旧的慢解析结果不得覆盖新结果（否则子 UI 首次不显示）
    let cancelled = false

    parseWorkflowGraph(currentWorkflow.yamlConfig)
      .then(({ nodes: parsedNodes, edges: parsedEdges }) => {
        const rawNodes: Node[] = parsedNodes.map((n) => {
          const nodeDef = n.id === '__start__' || n.id === '__end__' ? undefined : matchNodeDef(n.id)
          return {
            id: n.id,
            type: n.id === '__start__' || n.id === '__end__' ? 'terminalNode' : 'glowNode',
            position: { x: 0, y: 0 },
            data: {
              id: n.id,
              name: n.label,
              status: nodeStatuses[n.id] || 'idle',
              accentColor: nodeDef?.ui ? '#a855f7' : '#6366f1',
              inputs: nodeRuntimeData[n.id]?.inputs,
              outputs: nodeRuntimeData[n.id]?.outputs,
              direction,
              nodeRef: nodeDef?.name,
              nodeDbId: nodeDef?.id,
              nodeUpdatedAt: nodeDef?.updatedAt ? String(nodeDef.updatedAt) : undefined,
              ui: nodeDef?.ui,
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
            animated: nodeStatuses[e.source] === 'running',
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
  }, [currentWorkflow, direction, nodeDefs, setNodes, setEdges])

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

  // 实时同步执行状态
  useEffect(() => {
    if (!nodeStatuses || Object.keys(nodeStatuses).length === 0) return

    setNodes((nds) =>
      nds.map((node) => {
        const status = nodeStatuses[node.id]
        if (status && status !== node.data.status) {
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
          animated: nodeStatuses[edge.source] === 'running',
          status: nodeStatuses[edge.target] === 'failed' ? 'failed' : 'normal',
        },
      }))
    )
  }, [nodeStatuses, setNodes, setEdges])

  // 同步节点运行时数据（入参和返回）
  useEffect(() => {
    if (!nodeRuntimeData || Object.keys(nodeRuntimeData).length === 0) return

    setNodes((nds) =>
      nds.map((node) => {
        const runtime = nodeRuntimeData[node.id]
        if (!runtime) return node

        const hasChanges =
          JSON.stringify(runtime.inputs) !== JSON.stringify(node.data.inputs) ||
          JSON.stringify(runtime.outputs) !== JSON.stringify(node.data.outputs)

        if (hasChanges) {
          return {
            ...node,
            data: {
              ...node.data,
              inputs: runtime.inputs,
              outputs: runtime.outputs,
            },
          }
        }
        return node
      })
    )
  }, [nodeRuntimeData, setNodes])

  const executionStore = useExecutionStore()
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
        executionStore.startExecution(id)
        executionStore.selectExecution(id)
      }
      return
    }

    if (type === 'execution_start') {
      const payload = data as {
        execution_id?: number
        params?: Record<string, unknown>
      }
      if (payload.execution_id) {
        executionStore.updateExecutionMetadata(String(payload.execution_id), {
          status: 'running',
          params: payload.params || {},
        })
      }
      return
    }

    if (type === 'node_start') {
      const payload = data as { node_id?: string }
      if (payload.node_id) updateNodeStatus(payload.node_id, 'running')
      return
    }

    if (type === 'node_complete') {
      const payload = data as { node_id?: string; status?: string }
      if (payload.node_id) {
        updateNodeStatus(payload.node_id, statusMap[payload.status || ''] || 'idle')
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
        executionStore.appendRealtimeLog({
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
        executionStore.updateExecutionMetadata(String(payload.execution_id), {
          status: (payload.status || 'success').toLowerCase(),
          params: payload.params || {},
          metadata: payload.metadata || {},
        })
      }
      return
    }

    if (type === 'execution.completed') {
      const payload = data as { execution_id?: number; status?: string }
      if (payload.execution_id) {
        executionStore.stopExecution()
        executionStore.updateExecutionStatus(
          String(payload.execution_id),
          (payload.status as ExecutionStatus['status']) || 'success'
        )
        executionStore.selectExecution(String(payload.execution_id))
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
        nodesDraggable={!isMobile}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnScroll={true}
        panOnDrag={true}
        selectionOnDrag={false}
        className="canvas-background"
      >
        {/* 星空点阵背景 */}
        <Background
          color="rgba(255,255,255,0.03)"
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
              button: { background: 'transparent', color: 'rgba(255,255,255,0.6)', border: 'none' },
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
            maskColor="rgba(10, 14, 39, 0.7)"
          />
        )}

        {/* 状态面板 */}
        <Panel position="top-right" className={`${isMobile ? 'm-2' : 'm-4'}`}>
          <div className="flex items-center gap-2">
            <div className={`glass-panel px-3 py-1.5 text-white/60 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
              {currentWorkflow?.name || '未选择工作流'}
            </div>
            <button
              onClick={() => setDirection((d) => (d === 'TB' ? 'LR' : 'TB'))}
              className="glass-panel p-1.5 rounded-lg text-white/60 hover:text-white/80 hover:bg-white/10 transition-colors"
              title={direction === 'TB' ? '切换为横向布局' : '切换为竖向布局'}
            >
              {direction === 'TB' ? (
                <ArrowLeftRight className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
              ) : (
                <ArrowUpDown className={isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
              )}
            </button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}

export default function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  )
}
