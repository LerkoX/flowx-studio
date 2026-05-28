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

const nodeTypes = { glowNode: GlowNode }
const edgeTypes = { gradientEdge: GradientEdge }

function WorkflowCanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [, setSelectedNode] = useState<string | null>(null)
  const { currentWorkflow, nodeStatuses } = useWorkflowStore()

  // 初始加载
  useEffect(() => {
    if (!currentWorkflow?.yamlConfig) {
      // 演示数据
      const demoNodes: Node[] = [
        {
          id: 'start',
          type: 'glowNode',
          position: { x: 0, y: 0 },
          data: { id: 'start', name: 'Start', status: 'success', icon: '▶', accentColor: '#6366f1' },
        },
        {
          id: 'build',
          type: 'glowNode',
          position: { x: 0, y: 0 },
          data: { id: 'build', name: 'Build', status: 'running', icon: '🔨', accentColor: '#22d3ee', language: 'go' },
        },
        {
          id: 'test',
          type: 'glowNode',
          position: { x: 0, y: 0 },
          data: { id: 'test', name: 'Test', status: 'idle', icon: '🧪', accentColor: '#a855f7', language: 'go' },
        },
        {
          id: 'deploy',
          type: 'glowNode',
          position: { x: 0, y: 0 },
          data: { id: 'deploy', name: 'Deploy', status: 'idle', icon: '🚀', accentColor: '#34d399' },
        },
      ]
      const demoEdges: Edge[] = [
        { id: 'e1', source: 'start', target: 'build', type: 'gradientEdge', data: { animated: true } },
        { id: 'e2', source: 'build', target: 'test', type: 'gradientEdge' },
        { id: 'e3', source: 'test', target: 'deploy', type: 'gradientEdge' },
      ]

      const { nodes: layoutedNodes, edges: layoutedEdges } = autoLayout(demoNodes, demoEdges, { direction: 'TB' })
      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
      return
    }

    try {
      // 实际解析 YAML 和 Mermaid
      const { nodes: rawNodes, edges: rawEdges } = parseWorkflowToFlow(currentWorkflow.yamlConfig, nodeStatuses)
      const { nodes: layoutedNodes, edges: layoutedEdges } = autoLayout(rawNodes, rawEdges, { direction: 'TB' })
      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
    } catch (err) {
      console.error('Failed to parse workflow graph:', err)
    }
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

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id)
  }, [])

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
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        className="canvas-background"
      >
        {/* 星空点阵背景 */}
        <Background
          color="rgba(255,255,255,0.03)"
          gap={24}
          size={1}
          style={{ background: 'transparent' }}
        />

        {/* 控制按钮 */}
        <Controls
          className="!bg-white/5 !border-white/10 !backdrop-blur-xl !rounded-xl"
          style={{
            // @ts-expect-error React Flow custom style
            button: { background: 'transparent', color: 'rgba(255,255,255,0.6)', border: 'none' },
          }}
        />

        {/* 小地图 */}
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

        {/* 状态面板 */}
        <Panel position="top-right" className="m-4">
          <div className="glass-panel px-4 py-2 text-xs text-white/60">
            {currentWorkflow?.name || '演示工作流'}
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

// 简单的解析函数（实际项目中需要完整实现）
function parseWorkflowToFlow(yamlConfig: string, _statuses?: Record<string, string>): { nodes: Node[]; edges: Edge[] } {
  // 这里应该解析 YAML 和 Mermaid 图
  // 目前返回空数组，依赖 useEffect 中的演示数据
  console.log('Parsing workflow:', yamlConfig)
  return { nodes: [], edges: [] }
}
