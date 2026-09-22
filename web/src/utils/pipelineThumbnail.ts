import yaml from 'js-yaml'

/**
 * 流水线缩略图：从 FlowX YAML 的 Graph（stateDiagram-v2）提取节点/连线并做简单分层布局。
 *
 * 刻意不依赖 mermaid（~650KB）与 dagre：列表页是首屏路由，画布页的重依赖不该被列表页带出来。
 * 用 js-yaml 取 Graph（兼容 `Graph: |` 块标量与 CLI 重编码后的折叠双引号标量），
 * 这里只服务于"结构预览"——节点与方向正确即可。
 */

export interface ThumbnailNode {
  id: string
  label: string
  x: number
  y: number
}

export interface ThumbnailEdge {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** 回边（目标在源左侧的循环连线）：虚线区分 */
  dashed: boolean
}

export interface ThumbnailGraph {
  nodes: ThumbnailNode[]
  edges: ThumbnailEdge[]
  /** SVG viewBox，坐标已归一化到 (PAD,PAD) 起点 */
  viewBox: string
  width: number
  height: number
}

// 与画布节点卡片默认占位保持一致的视觉比例
const NODE_W = 220
const NODE_H = 100
const GAP_X = 56
const GAP_Y = 24
const PAD = 24
const MAX_LABEL = 9

/** 起止伪状态 [*]，缩略图不画 */
const TERMINAL = '[*]'

interface RawEdge {
  source: string
  target: string
}

/** 用 js-yaml 取出 Graph 文本与 Nodes 键名；解析失败返回空（缩略图显示占位） */
export function parseWorkflowDoc(yamlConfig: string): { graph: string; nodes: string[] } {
  try {
    const doc = yaml.load(yamlConfig) as Record<string, unknown> | undefined
    if (!doc || typeof doc !== 'object') return { graph: '', nodes: [] }
    const graph = doc.Graph ?? doc.graph
    const nodes = doc.Nodes ?? doc.nodes
    return {
      graph: typeof graph === 'string' ? graph : '',
      nodes:
        nodes && typeof nodes === 'object' && !Array.isArray(nodes)
          ? Object.keys(nodes as Record<string, unknown>)
          : [],
    }
  } catch {
    return { graph: '', nodes: [] }
  }
}

/** 解析 Graph 中的转移关系与 state 别名/描述 */
export function parseGraphSection(graphBlock: string): {
  edges: RawEdge[]
  labels: Record<string, string>
} {
  const edges: RawEdge[] = []
  const labels: Record<string, string> = {}

  for (const rawLine of graphBlock.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('%%') || line.startsWith('stateDiagram')) continue
    if (line.startsWith('direction') || line === '{' || line === '}') continue

    const alias = /^state\s+"([^"]+)"\s+as\s+(\S+)/.exec(line)
    if (alias) {
      labels[alias[2]] = alias[1]
      continue
    }

    const arrow = line.indexOf('-->')
    if (arrow >= 0) {
      const source = line.slice(0, arrow).trim()
      const rest = line.slice(arrow + 3).trim()
      // 转移标签形如 "-->" 之后的 ": {{ iteration < 3 }}"，只取目标节点
      const colon = rest.indexOf(':')
      const target = (colon >= 0 ? rest.slice(0, colon) : rest).trim()
      if (!source || !target) continue
      if (source === TERMINAL && target === TERMINAL) continue
      edges.push({ source, target })
      continue
    }

    // `NodeId : 描述`：mermaid 的状态描述，作为节点标签
    const desc = /^([\w.-]+)\s*:\s*(.+)$/.exec(line)
    if (desc) labels[desc[1]] = desc[2].trim()
  }

  return { edges, labels }
}

/**
 * 最长路径分层（LR）：level(node) = max(level(parent)) + 1。
 * 回边（循环）不参与分层，否则层号会无限增长。
 */
function assignLevels(ids: string[], edges: RawEdge[]): Map<string, number> {
  const incoming = new Map<string, string[]>()
  ids.forEach((id) => incoming.set(id, []))
  edges.forEach((e) => {
    if (!incoming.has(e.source) || !incoming.has(e.target)) return
    incoming.get(e.target)!.push(e.source)
  })

  const levels = new Map<string, number>()
  const visiting = new Set<string>()
  const resolve = (id: string): number => {
    const cached = levels.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0 // 回边：按起点层处理，保证终止
    visiting.add(id)
    let level = 0
    for (const parent of incoming.get(id) || []) {
      level = Math.max(level, resolve(parent) + 1)
    }
    visiting.delete(id)
    levels.set(id, level)
    return level
  }

  ids.forEach(resolve)
  return levels
}

function truncate(label: string): string {
  const text = label.trim() || ''
  if (text.length <= MAX_LABEL) return text
  return `${text.slice(0, MAX_LABEL)}…`
}

/** 解析 + 布局（左→右分层）；无法提取任何节点时返回 null */
export function buildThumbnailGraph(yamlConfig: string): ThumbnailGraph | null {
  const doc = parseWorkflowDoc(yamlConfig)
  const { edges: parsedEdges, labels } = parseGraphSection(doc.graph)

  const ids: string[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    if (id === TERMINAL || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  // 连线端点在前（决定层内顺序），Nodes 段里未被连线引用的节点追加在后
  parsedEdges.forEach((e) => {
    push(e.source)
    push(e.target)
  })
  doc.nodes.forEach(push)
  if (ids.length === 0) return null

  const edges = parsedEdges.filter((e) => seen.has(e.source) && seen.has(e.target))
  const levels = assignLevels(ids, edges)

  // 按层分组，层内保持节点首次出现顺序（连线交叉更少）
  const columns = new Map<number, string[]>()
  ids.forEach((id) => {
    const level = levels.get(id) ?? 0
    const column = columns.get(level) || []
    column.push(id)
    columns.set(level, column)
  })

  const stepX = NODE_W + GAP_X
  const stepY = NODE_H + GAP_Y
  const maxCount = Math.max(...Array.from(columns.values(), (c) => c.length))

  const positions = new Map<string, { x: number; y: number }>()
  columns.forEach((column, level) => {
    // 层内居中，避免短列贴顶
    const offset = ((maxCount - column.length) * stepY) / 2
    column.forEach((id, index) => {
      positions.set(id, { x: PAD + level * stepX, y: PAD + offset + index * stepY })
    })
  })

  const nodes: ThumbnailNode[] = ids.map((id) => {
    const pos = positions.get(id)!
    return { id, label: truncate(labels[id] || id), x: pos.x, y: pos.y }
  })
  const center = (id: string) => {
    const pos = positions.get(id)!
    return { x: pos.x + NODE_W / 2, y: pos.y + NODE_H / 2 }
  }
  const thumbEdges: ThumbnailEdge[] = edges.map((e, index) => {
    const from = center(e.source)
    const to = center(e.target)
    const sourcePos = positions.get(e.source)!
    const targetPos = positions.get(e.target)!
    return {
      id: `${e.source}->${e.target}#${index}`,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      dashed: targetPos.x <= sourcePos.x,
    }
  })

  const width = Math.max(...nodes.map((n) => n.x + NODE_W)) + PAD
  const height = Math.max(...nodes.map((n) => n.y + NODE_H)) + PAD
  return { nodes, edges: thumbEdges, viewBox: `0 0 ${width} ${height}`, width, height }
}

export const THUMBNAIL_NODE_SIZE = { width: NODE_W, height: NODE_H }
