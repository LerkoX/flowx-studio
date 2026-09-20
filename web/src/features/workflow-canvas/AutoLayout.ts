import dagre from 'dagre'
import type { Node, Edge } from '@xyflow/react'

const NODE_WIDTH = 220
const NODE_HEIGHT = 100
const RANK_SEP = 48
const NODE_SEP = 16

// 内嵌 UI 组件时节点卡片的额外占位（内边距 + 边框 + 间距）
const WIDGET_PAD_X = 28
const WIDGET_PAD_Y = 24

// 同层收拢后处理：dagre 的横向定位（Brandes-Köpf）会把每个节点向其跨层
// 邻居对齐以拉直长边，导致同层节点被撕开（中间出现大片空白）。此处每轮把
// 节点向其连线邻居的平均位置靠拢 COMPACT_DAMPING 比例，同时强制层内保持
// 原有次序且间距不小于 NODE_SEP——只压缩位移、不重排次序，因此不会引入
// 额外的连线交叉（交叉数只取决于层内次序，本次处理不改变次序）。
const COMPACT_ITERS = 10
const COMPACT_DAMPING = 0.5

interface LayoutNodeData {
  ui?: { width?: number; height?: number }
}

interface Size {
  width: number
  height: number
}

function nodeSize(node: Node): Size {
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

/**
 * 同层收拢：在 dagre 结果上把同层节点向其连线邻居的平均位置靠拢。
 * TB 模式按 y 分层、沿 x 收拢；LR 模式按 x 分层、沿 y 收拢。
 * 只修改传入的 positions（中心点坐标），节点在层内的相对次序保持不变。
 */
function compactRanks(
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, Size>,
  edges: Edge[],
  direction: 'TB' | 'LR'
): void {
  const crossAxis: 'x' | 'y' = direction === 'TB' ? 'x' : 'y'
  const rankAxis: 'x' | 'y' = direction === 'TB' ? 'y' : 'x'
  const sizeKey: 'width' | 'height' = direction === 'TB' ? 'width' : 'height'

  // 无向邻居表（父+子节点都算，向连线两端靠拢）
  const neighbors = new Map<string, string[]>()
  edges.forEach((edge) => {
    neighbors.set(edge.source, [...(neighbors.get(edge.source) || []), edge.target])
    neighbors.set(edge.target, [...(neighbors.get(edge.target) || []), edge.source])
  })

  // 按层分组：dagre 同层节点的 rank 轴中心坐标一致，取整做 key 兜底浮点误差
  const ranks = new Map<number, string[]>()
  positions.forEach((pos, id) => {
    const key = Math.round(pos[rankAxis])
    const row = ranks.get(key) || []
    row.push(id)
    ranks.set(key, row)
  })

  for (let iter = 0; iter < COMPACT_ITERS; iter++) {
    ranks.forEach((row) => {
      if (row.length < 2) return
      row.sort((a, b) => positions.get(a)![crossAxis] - positions.get(b)![crossAxis])
      row.forEach((id) => {
        const nbs = neighbors.get(id)
        if (!nbs || nbs.length === 0) return
        const avg = nbs.reduce((sum, nb) => sum + (positions.get(nb)?.[crossAxis] ?? 0), 0) / nbs.length
        const pos = positions.get(id)!
        pos[crossAxis] += (avg - pos[crossAxis]) * COMPACT_DAMPING
      })
      // 靠拢后按新位置重排并强制最小间距：保持从左到右（TB）/从上到下（LR）
      // 不重叠、次序不交换（次序不变 ⇒ 连线交叉数不变）
      row.sort((a, b) => positions.get(a)![crossAxis] - positions.get(b)![crossAxis])
      for (let i = 1; i < row.length; i++) {
        const prev = positions.get(row[i - 1])!
        const cur = positions.get(row[i])!
        const minGap =
          ((sizes.get(row[i - 1])?.[sizeKey] ?? NODE_WIDTH) +
            (sizes.get(row[i])?.[sizeKey] ?? NODE_WIDTH)) /
            2 +
          NODE_SEP
        if (cur[crossAxis] - prev[crossAxis] < minGap) {
          cur[crossAxis] = prev[crossAxis] + minGap
        }
      }
    })
  }
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

  const sizes = new Map<string, Size>()
  nodes.forEach((node) => {
    const size = nodeSize(node)
    sizes.set(node.id, size)
    dagreGraph.setNode(node.id, size)
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  // 收集中心点坐标，做同层收拢
  const positions = new Map<string, { x: number; y: number }>()
  nodes.forEach((node) => {
    const p = dagreGraph.node(node.id)
    positions.set(node.id, { x: p.x, y: p.y })
  })
  compactRanks(positions, sizes, edges, direction)

  const layoutedNodes = nodes.map((node) => {
    const center = positions.get(node.id)!
    const size = sizes.get(node.id) || { width: NODE_WIDTH, height: NODE_HEIGHT }
    return {
      ...node,
      position: {
        x: center.x - size.width / 2,
        y: center.y - size.height / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}
