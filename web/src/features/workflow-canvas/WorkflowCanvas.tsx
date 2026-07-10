import { useCallback, useEffect, useState } from 'react'
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
import GradientEdge from '@/components/GradientEdge'
import { autoLayout } from './AutoLayout'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { parseWorkflowGraph } from '@/utils/mermaidParser'
import { useEventStream } from '@/services/eventService'

const nodeTypes = { glowNode: GlowNode }
const edgeTypes = { gradientEdge: GradientEdge }

const statusMap: Record<string, string> = {
  running: 'running',
  success: 'success',
  failed: 'failed',
}

function WorkflowCanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [, setSelectedNode] = useState<string | null>(null)
  const {
    currentWorkflow,
    nodeStatuses,
    nodeRuntimeData,
    updateNodeStatus,
    setNodeStatuses,
  } = useWorkflowStore()

  // 解析 YAML Graph 并渲染工作流
  useEffect(() => {
    if (!currentWorkflow?.yamlConfig) {
      setNodes([])
      setEdges([])
      return
    }

    parseWorkflowGraph(currentWorkflow.yamlConfig)
      .then(({ nodes: parsedNodes, edges: parsedEdges }) => {
        const rawNodes: Node[] = parsedNodes.map((n) => ({
          id: n.id,
          type: 'glowNode',
          position: { x: 0, y: 0 },
          data: {
            id: n.id,
            name: n.label,
            status: nodeStatuses[n.id] || 'idle',
            accentColor: '#6366f1',
            inputs: nodeRuntimeData[n.id]?.inputs,
            outputs: nodeRuntimeData[n.id]?.outputs,
          },
        }))

        const rawEdges: Edge[] = parsedEdges.map((e, idx) => ({
          id: `e${idx}`,
          source: e.source,
          target: e.target,
          type: 'gradientEdge',
          data: {
            animated: nodeStatuses[e.source] === 'running',
          },
        }))

        const { nodes: layoutedNodes, edges: layoutedEdges } = autoLayout(rawNodes, rawEdges, { direction: 'TB' })
        setNodes(layoutedNodes)
        setEdges(layoutedEdges)
      })
      .catch((err) => {
        console.error('Failed to parse workflow graph:', err)
        setNodes([])
        setEdges([])
      })
  }, [currentWorkflow, setNodes, setEdges])

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

  // 订阅 SSE 事件
  useEventStream('/api/v1/events', (type, data) => {
    if (type === 'execution.started') {
      setNodeStatuses({})
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

    if (type === 'execution.completed') {
      // 执行结束后整体状态由 node_complete 覆盖
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
          <div className={`glass-panel px-3 py-1.5 text-white/60 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
            {currentWorkflow?.name || '未选择工作流'}
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
