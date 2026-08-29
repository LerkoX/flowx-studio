import dagre from 'dagre'
import type { Node, Edge } from '@xyflow/react'

const NODE_WIDTH = 220
const NODE_HEIGHT = 100
const RANK_SEP = 100
const NODE_SEP = 60

// 内嵌 UI 组件时节点卡片的额外占位（内边距 + 边框 + 间距）
const WIDGET_PAD_X = 28
const WIDGET_PAD_Y = 24

interface LayoutNodeData {
  ui?: { width?: number; height?: number }
}

function nodeSize(node: Node): { width: number; height: number } {
  // 优先使用 React Flow 实测尺寸（组件挂载/详情展开后的真实渲染大小），
  // 保证布局占位与实际渲染一致，避免节点重叠
  const measured = node.measured
  if (measured?.width && measured?.height) {
    return { width: measured.width, height: measured.height }
  }
  const data = node.data as LayoutNodeData | undefined
  if (data?.ui) {
    return {
      width: Math.max(NODE_WIDTH, (data.ui.width || 260) + WIDGET_PAD_X),
      height: NODE_HEIGHT + (data.ui.height || 120) + WIDGET_PAD_Y,
    }
  }
  return { width: NODE_WIDTH, height: NODE_HEIGHT }
}

export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  options: { direction?: 'TB' | 'LR' } = {}
): { nodes: Node[]; edges: Edge[] } {
  const { direction = 'TB' } = options

  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
  })

  const sizes = new Map<string, { width: number; height: number }>()
  nodes.forEach((node) => {
    const size = nodeSize(node)
    sizes.set(node.id, size)
    dagreGraph.setNode(node.id, size)
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    const size = sizes.get(node.id) || { width: NODE_WIDTH, height: NODE_HEIGHT }
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - size.width / 2,
        y: nodeWithPosition.y - size.height / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}
