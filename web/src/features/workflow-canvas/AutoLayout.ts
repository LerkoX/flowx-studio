import dagre from 'dagre'
import { Position, type Node, type Edge } from '@xyflow/react'
import { sampleRoutedBezier } from './edgeRouting'

const NODE_WIDTH = 220
const NODE_HEIGHT = 100
// 给层间/同层连线预留通道，降低长连线穿过中间节点的概率
const RANK_SEP = 64
const NODE_SEP = 28
const EDGE_NODE_GAP = 14
const ROUTE_OFFSET_CANDIDATES = [40, 64, 88, 120, 160, 220, 300, 400, 540, 720, 960, 1200]

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

interface NodeBox {
  left: number
  right: number
  top: number
  bottom: number
}

function buildNodeBoxes(
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, Size>,
): Map<string, NodeBox> {
  const boxes = new Map<string, NodeBox>()
  positions.forEach((center, id) => {
    const size = sizes.get(id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT }
    boxes.set(id, {
      left: center.x - size.width / 2 - EDGE_NODE_GAP,
      right: center.x + size.width / 2 + EDGE_NODE_GAP,
      top: center.y - size.height / 2 - EDGE_NODE_GAP,
      bottom: center.y + size.height / 2 + EDGE_NODE_GAP,
    })
  })
  return boxes
}

function edgeRouteParams(
  edge: Edge,
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, Size>,
  direction: 'TB' | 'LR',
  controlOffset: number,
) {
  const sourceCenter = positions.get(edge.source)
  const targetCenter = positions.get(edge.target)
  if (!sourceCenter || !targetCenter) return null

  const sourceSize = sizes.get(edge.source) ?? { width: NODE_WIDTH, height: NODE_HEIGHT }
  const targetSize = sizes.get(edge.target) ?? { width: NODE_WIDTH, height: NODE_HEIGHT }

  if (direction === 'LR') {
    return {
      sourceX: sourceCenter.x + sourceSize.width / 2,
      sourceY: sourceCenter.y,
      sourcePosition: Position.Right,
      targetX: targetCenter.x - targetSize.width / 2,
      targetY: targetCenter.y,
      targetPosition: Position.Left,
      controlOffset,
    }
  }

  return {
    sourceX: sourceCenter.x,
    sourceY: sourceCenter.y + sourceSize.height / 2,
    sourcePosition: Position.Bottom,
    targetX: targetCenter.x,
    targetY: targetCenter.y - targetSize.height / 2,
    targetPosition: Position.Top,
    controlOffset,
  }
}

function collidingNodeIds(
  edge: Edge,
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, Size>,
  boxes: Map<string, NodeBox>,
  direction: 'TB' | 'LR',
  controlOffset: number,
): Set<string> {
  const params = edgeRouteParams(edge, positions, sizes, direction, controlOffset)
  const collisions = new Set<string>()
  if (!params) return collisions

  // 端点附近本来就会接触自身节点，跳过首尾采样点
  const samples = sampleRoutedBezier(params, 36).slice(2, -2)
  for (const point of samples) {
    boxes.forEach((box, nodeId) => {
      if (nodeId === edge.source || nodeId === edge.target || collisions.has(nodeId)) return
      if (
        point.x >= box.left &&
        point.x <= box.right &&
        point.y >= box.top &&
        point.y <= box.bottom
      ) {
        collisions.add(nodeId)
      }
    })
  }

  return collisions
}

function chooseControlOffset(
  edge: Edge,
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, Size>,
  boxes: Map<string, NodeBox>,
  direction: 'TB' | 'LR',
): number {
  const baseCollisions = collidingNodeIds(edge, positions, sizes, boxes, direction, 0)
  if (baseCollisions.size === 0) return 0

  let bestOffset = 0
  let bestCollisionCount = baseCollisions.size

  for (const side of [-1, 1]) {
    for (const magnitude of ROUTE_OFFSET_CANDIDATES) {
      const offset = side * magnitude
      const collisionCount = collidingNodeIds(edge, positions, sizes, boxes, direction, offset).size
      if (collisionCount === 0) return offset
      if (collisionCount < bestCollisionCount) {
        bestOffset = offset
        bestCollisionCount = collisionCount
      }
    }
  }

  // 无法完全绕开时，至少使用碰撞更少的一侧；没有改善则保持原始路径
  return bestOffset
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

  const boxes = buildNodeBoxes(positions, sizes)
  const layoutedEdges = edges.map((edge) => {
    const data = { ...(edge.data ?? {}) } as Record<string, unknown>
    delete data.controlOffset

    // 长连线如果穿过中间节点，只给这条边增加控制点偏移绕行；
    // 普通无碰撞连线仍保持原贝塞尔路径
    const controlOffset = chooseControlOffset(edge, positions, sizes, boxes, direction)
    if (controlOffset !== 0) {
      data.controlOffset = controlOffset
    }

    return { ...edge, data }
  })

  return { nodes: layoutedNodes, edges: layoutedEdges }
}
