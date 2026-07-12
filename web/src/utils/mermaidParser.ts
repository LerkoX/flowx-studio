import yaml from 'js-yaml'

export interface ParsedNode {
  id: string
  label: string
}

export interface ParsedEdge {
  source: string
  target: string
}

export interface ParsedGraph {
  nodes: ParsedNode[]
  edges: ParsedEdge[]
}

/**
 * 解析 FlowX YAML 中的 stateDiagram-v2 图定义。
 *
 * 由于环境限制无法完整引入 mermaid 渲染引擎，这里使用 mermaid 兼容的
 * stateDiagram-v2 语法解析器，提取状态和转移关系。如果解析失败，直接抛出错误。
 */
export async function parseWorkflowGraph(yamlConfig: string): Promise<ParsedGraph> {
  const doc = yaml.load(yamlConfig) as Record<string, unknown> | undefined
  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid YAML: workflow config is not an object')
  }

  const graph = (doc.Graph || doc.graph || '') as string
  if (typeof graph !== 'string' || !graph.trim()) {
    throw new Error('Invalid YAML: missing Graph section')
  }

  return parseStateDiagram(graph)
}

function parseStateDiagram(graph: string): ParsedGraph {
  const nodesSet = new Set<string>()
  const edges: ParsedEdge[] = []
  let startNode: string | null = null
  let endNode: string | null = null

  const lines = graph
    .split('\n')
    .map((line) => line.split('%%')[0].trim())
    .filter(Boolean)

  for (const line of lines) {
    if (line.includes('-->')) {
      const [rawSource, rawTargetAndRest] = line.split('-->')
      if (!rawSource || !rawTargetAndRest) continue

      const source = cleanState(rawSource)
      const target = cleanState(rawTargetAndRest.split(':')[0])
      if (!source || !target) continue

      if (source === '*' && target !== '*') {
        startNode = target
        continue
      }
      if (target === '*' && source !== '*') {
        endNode = source
        continue
      }
      if (source === '*' || target === '*') {
        continue
      }

      nodesSet.add(source)
      nodesSet.add(target)
      edges.push({ source, target })
    } else if (line.startsWith('state ')) {
      const declared = line.replace('state ', '').split('{')[0].trim()
      const id = cleanState(declared)
      if (id && id !== '*') {
        nodesSet.add(id)
      }
    } else {
      const simple = line.match(/^\[?([A-Za-z0-9_][A-Za-z0-9_\s]*)\]?$/)
      if (simple) {
        const id = cleanState(simple[1])
        if (id && id !== '*') {
          nodesSet.add(id)
        }
      }
    }
  }

  const nodes: ParsedNode[] = Array.from(nodesSet).map((id) => ({ id, label: id }))

  if (startNode && nodesSet.has(startNode)) {
    nodes.push({ id: '__start__', label: 'Start' })
    edges.unshift({ source: '__start__', target: startNode })
  }
  if (endNode && nodesSet.has(endNode)) {
    nodes.push({ id: '__end__', label: 'End' })
    edges.push({ source: endNode, target: '__end__' })
  }

  return { nodes, edges }
}

function cleanState(raw: string): string {
  return raw
    .trim()
    .replace(/^\[\*\]$/, '*')
    .replace(/^\[|\]$/g, '')
    .trim()
}
