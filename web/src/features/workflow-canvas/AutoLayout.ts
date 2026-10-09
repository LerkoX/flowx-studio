import ELK, { type ELK as ElkApi, type ElkExtendedEdge, type ElkNode, type ElkPoint } from 'elkjs/lib/elk-api.js'
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'
import type { Node, Edge } from '@xyflow/react'

const NODE_WIDTH = 220
const NODE_HEIGHT = 100
const RANK_SEP = 64
const NODE_SEP = 28

// 内嵌 UI 组件时节点卡片的额外占位（内边距 + 边框 + 间距）
const WIDGET_PAD_X = 28
const WIDGET_PAD_Y = 24

let elkInstancePromise: Promise<ElkApi> | null = null

function getElk(): Promise<ElkApi> {
  if (elkInstancePromise) return elkInstancePromise

  // 浏览器端使用独立 worker，主包只引入 12KB 的 elk-api，避免 1.6MB
  // bundled/minified worker 进入 Vite 转换链路导致构建内存暴涨。
  if (typeof Worker !== 'undefined') {
    elkInstancePromise = Promise.resolve(new ELK({
      workerUrl: elkWorkerUrl,
      workerFactory: (url) => new Worker(url as string),
    }))
    return elkInstancePromise
  }

  // Vitest/Node 没有浏览器 Worker：测试时回退到 bundled 版本。
  // @vite-ignore 防止生产构建把 bundled worker 打进前端包。
  const bundledModulePath = 'elkjs/lib/elk.bundled.js'
  elkInstancePromise = import(/* @vite-ignore */ bundledModulePath)
    .then((module) => new module.default())
  return elkInstancePromise
}

interface LayoutNodeData {
  ui?: { width?: number; height?: number }
}

interface Size {
  width: number
  height: number
}

function nodeSize(node: Node): Size {
  // 优先使用 React Flow 实测尺寸（组件挂载/详情展开后的真实渲染大小），
  // 保证 ELK 布局占位与实际渲染一致，避免节点重叠
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

function routePoints(edge: ElkExtendedEdge): ElkPoint[] | undefined {
  const section = edge.sections?.[0]
  if (!section) return undefined
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
}

/**
 * 使用 ELK Layered 做全局图布局：节点分层、交叉优化、节点坐标和正交连线路由
 * 在同一次布局中完成，比「dagre 摆节点 + React Flow 各自画贝塞尔线」更接近
 * Mermaid/工程流程图的整齐效果。
 */
export async function autoLayout(
  nodes: Node[],
  edges: Edge[],
  options: { direction?: 'TB' | 'LR' } = {}
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const { direction = 'TB' } = options

  const sizes = new Map<string, Size>()
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'LR' ? 'RIGHT' : 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      // 尽量保留 Mermaid 中节点/连线的声明顺序，减少同层节点无意义交换
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.spacing.nodeNode': String(NODE_SEP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(RANK_SEP),
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.separateConnectedComponents': 'true',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
    children: nodes.map((node) => {
      const size = nodeSize(node)
      sizes.set(node.id, size)
      return {
        id: node.id,
        width: size.width,
        height: size.height,
      }
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  const elk = await getElk()
  const layouted = await elk.layout(graph)
  const layoutedNodesById = new Map((layouted.children ?? []).map((child) => [child.id, child]))
  const layoutedEdgesById = new Map((layouted.edges ?? []).map((edge) => [edge.id, edge]))

  const layoutedNodes = nodes.map((node) => {
    const layoutedNode = layoutedNodesById.get(node.id)
    return {
      ...node,
      position: {
        x: Math.round(layoutedNode?.x ?? 0),
        y: Math.round(layoutedNode?.y ?? 0),
      },
    }
  })

  const layoutedEdges = edges.map((edge) => {
    const data = { ...(edge.data ?? {}) } as Record<string, unknown>
    delete data.routePoints

    const points = layoutedEdgesById.get(edge.id)
      ? routePoints(layoutedEdgesById.get(edge.id)!)
      : undefined
    if (points && points.length >= 2) {
      data.routePoints = points
    }

    return { ...edge, data }
  })

  return { nodes: layoutedNodes, edges: layoutedEdges }
}
