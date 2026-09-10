import yaml from 'js-yaml'
import type mermaidType from 'mermaid'
import type { NodeWidgetParamSource } from '@/types/nodeWidget'

export interface ParsedNode {
  id: string
  label: string
}

export interface ParsedEdge {
  source: string
  target: string
  /** 转移条件标签（如 loop 回环条件），已剥离 {{ }} 模板符号 */
  label?: string
}

export interface ParsedGraph {
  nodes: ParsedNode[]
  edges: ParsedEdge[]
}

// mermaid 体积较大（~600KB），动态导入按需加载，避免拖慢首屏
let mermaidInstance: typeof mermaidType | null = null

async function getMermaid() {
  if (!mermaidInstance) {
    mermaidInstance = (await import('mermaid')).default
    mermaidInstance.initialize({ startOnLoad: false })
  }
  return mermaidInstance
}

/**
 * 解析 FlowX YAML 中的 stateDiagram-v2 图定义。
 *
 * 使用官方 mermaid 解析器（getDiagramFromText + stateDb）提取状态与转移关系，
 * 完整支持 stateDiagram-v2 语法（嵌套 state、描述、direction 等）。
 * 渲染仍由 ReactFlow 画布完成（保留执行状态高亮等交互），此处只做结构解析。
 * 解析失败时抛出错误。
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

/**
 * 从 FlowX YAML 中提取各节点实例的 nodeRef（节点包名）。
 * 返回 { 节点实例ID: 节点包名 }，用于画布将节点实例与节点包（含 ui 配置）关联。
 * 解析失败或节点未声明 nodeRef 时对应条目缺省。
 */
export function parseNodeRefs(yamlConfig: string): Record<string, string> {
  const result: Record<string, string> = {}
  try {
    const doc = yaml.load(yamlConfig) as Record<string, unknown> | undefined
    if (!doc || typeof doc !== 'object') return result
    const nodes = (doc.Nodes || doc.nodes) as Record<string, unknown> | undefined
    if (!nodes || typeof nodes !== 'object') return result
    for (const [id, def] of Object.entries(nodes)) {
      if (!def || typeof def !== 'object') continue
      const config = (def as Record<string, unknown>).config as Record<string, unknown> | undefined
      const ref = config?.nodeRef ?? (def as Record<string, unknown>).nodeRef
      if (typeof ref === 'string' && ref) result[id] = ref
    }
  } catch {
    // YAML 解析失败时返回已提取部分
  }
  return result
}

/**
 * 从 FlowX YAML 中提取各节点实例的参数绑定（config.params）。
 * 返回 { 节点实例ID: { 参数名: 绑定值 } }，值为常量或上游引用模板字符串。
 * 标量值统一转为 string（与后端 parseParamBindings 的 %v 语义一致）。
 * 解析失败或节点未绑定参数时对应条目缺省。
 */
export function parseNodeParams(yamlConfig: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  try {
    const doc = yaml.load(yamlConfig) as Record<string, unknown> | undefined
    if (!doc || typeof doc !== 'object') return result
    const nodes = (doc.Nodes || doc.nodes) as Record<string, unknown> | undefined
    if (!nodes || typeof nodes !== 'object') return result
    for (const [id, def] of Object.entries(nodes)) {
      if (!def || typeof def !== 'object') continue
      const config = (def as Record<string, unknown>).config as Record<string, unknown> | undefined
      const raw = config?.params
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const params: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        params[k] = typeof v === 'string' ? v : String(v)
      }
      if (Object.keys(params).length > 0) result[id] = params
    }
  } catch {
    // YAML 解析失败时返回已提取部分
  }
  return result
}

// 整串单模板匹配：{{ ... }}（允许内部空白），多模板拼接/混合文本视为字面值
const FULL_TEMPLATE_RE = /^\{\{\s*([^{}]+?)\s*\}\}$/

// 去掉模板过滤器（如 {{ Param.x | default(1) }} → "Param.x"）
function templateBase(expr: string): string {
  return expr.split('|')[0].trim()
}

// 解析单个绑定值的来源：{{ Param.xxx }} → pipeline；{{ NodeId.field }} → node；其余 → literal
function resolveParamSource(
  raw: string,
  pipelineParams: Record<string, unknown>,
  nodeNames: Record<string, string>,
): NodeWidgetParamSource {
  const m = FULL_TEMPLATE_RE.exec(raw)
  if (!m) return { kind: 'literal' }
  const base = templateBase(m[1])
  if (base.startsWith('Param.')) {
    const paramName = base.slice('Param.'.length).trim()
    const source: NodeWidgetParamSource = { kind: 'pipeline', paramName }
    if (paramName && Object.prototype.hasOwnProperty.call(pipelineParams, paramName)) {
      const v = unwrapPipelineParamValue(pipelineParams[paramName])
      if (v !== undefined) source.paramValue = v
    }
    return source
  }
  const dot = base.indexOf('.')
  if (dot > 0) {
    const nodeId = base.slice(0, dot).trim()
    const field = base.slice(dot + 1).trim()
    if (nodeId && field) {
      const source: NodeWidgetParamSource = { kind: 'node', nodeId, field }
      const displayName = nodeNames[nodeId]
      if (displayName) source.nodeName = displayName
      return source
    }
  }
  // 无法识别的模板表达式：按字面值处理（组件回退展示原始绑定串）
  return { kind: 'literal' }
}

// Param 区参数值解包：支持标量或 { value, description } 结构，统一转字符串
function unwrapPipelineParamValue(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>
    if ('value' in obj) return unwrapPipelineParamValue(obj.value)
    return undefined
  }
  return typeof v === 'string' ? v : String(v)
}

/**
 * 从 FlowX YAML 中提取各节点实例的显示名（Nodes.<id>.name）。
 * 返回 { 节点实例ID: 显示名 }，未设置 name 的节点条目缺省。
 */
export function parseNodeNames(yamlConfig: string): Record<string, string> {
  const result: Record<string, string> = {}
  try {
    const doc = yaml.load(yamlConfig) as Record<string, unknown> | undefined
    if (!doc || typeof doc !== 'object') return result
    const nodes = (doc.Nodes || doc.nodes) as Record<string, unknown> | undefined
    if (!nodes || typeof nodes !== 'object') return result
    for (const [id, def] of Object.entries(nodes)) {
      if (!def || typeof def !== 'object') continue
      const name = (def as Record<string, unknown>).name
      if (typeof name === 'string' && name) result[id] = name
    }
  } catch {
    // YAML 解析失败时返回已提取部分
  }
  return result
}

/**
 * 解析各节点实例参数绑定的来源信息（供节点自定义 UI 渲染「该值从哪来」）。
 * 返回 { 节点实例ID: { 参数名: 来源 } }：
 * - {{ Param.xxx }} → { kind: 'pipeline', paramName, paramValue（Param 区当前值） }
 * - {{ NodeId.field }} → { kind: 'node', nodeId, nodeName, field }（runtimeValue 由画布运行时补充）
 * - 字面值 / 无法识别的模板 → { kind: 'literal' }
 */
export function parseParamSources(
  yamlConfig: string,
): Record<string, Record<string, NodeWidgetParamSource>> {
  const result: Record<string, Record<string, NodeWidgetParamSource>> = {}
  try {
    const doc = yaml.load(yamlConfig) as Record<string, unknown> | undefined
    if (!doc || typeof doc !== 'object') return result
    const pipelineParams = ((doc.Param || doc.param) || {}) as Record<string, unknown>
    const nodeNames = parseNodeNames(yamlConfig)
    const nodes = (doc.Nodes || doc.nodes) as Record<string, unknown> | undefined
    if (!nodes || typeof nodes !== 'object') return result
    for (const [id, def] of Object.entries(nodes)) {
      if (!def || typeof def !== 'object') continue
      const config = (def as Record<string, unknown>).config as Record<string, unknown> | undefined
      const raw = config?.params
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const sources: Record<string, NodeWidgetParamSource> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const strVal = typeof v === 'string' ? v : String(v)
        sources[k] = resolveParamSource(strVal, pipelineParams, nodeNames)
      }
      if (Object.keys(sources).length > 0) result[id] = sources
    }
  } catch {
    // YAML 解析失败时返回已提取部分
  }
  return result
}

async function parseStateDiagram(graph: string): Promise<ParsedGraph> {
  const mermaid = await getMermaid()

  const diagram = await mermaid.mermaidAPI.getDiagramFromText(graph)
  if (diagram.type !== 'stateDiagram' && diagram.type !== 'state') {
    throw new Error(`Graph must be a stateDiagram-v2, got: ${diagram.type}`)
  }

  // stateDiagram 的 db 提供 getStates()/getRelations()
  const db = diagram.db as {
    getStates(): Map<string, { id: string; type?: string; descriptions?: string[] }>
    getRelations(): Array<{ id1: string; id2: string; title?: string }>
  }

  const states = db.getStates()
  const relations = db.getRelations()

  const nodesMap = new Map<string, ParsedNode>()
  const edges: ParsedEdge[] = []

  // 注册普通状态节点；mermaid 官方解析器将 [*] 起止伪状态表示为
  // id 形如 root_start / root_end 的节点（type 为 default）。
  // 注意只匹配 root_ 前缀，节点本身可以合法命名为 start/end
  const startIds: string[] = []
  const endIds: string[] = []
  for (const [id, stmt] of states) {
    if (/(^|_)root_start\d*$/.test(id)) {
      startIds.push(id)
      continue
    }
    if (/(^|_)root_end\d*$/.test(id)) {
      endIds.push(id)
      continue
    }
    const label = stmt.descriptions?.[0] || id
    nodesMap.set(id, { id, label })
  }

  const isStart = (id: string) => startIds.includes(id)
  const isEnd = (id: string) => endIds.includes(id)
  let hasStartEdge = false
  let hasEndEdge = false

  // mermaid 转移标签形如 "{{ iteration < 3 }}"，剥离模板符号后作为条件展示
  const extractLabel = (title?: string): string | undefined => {
    if (!title) return undefined
    const text = title.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim()
    return text || undefined
  }

  for (const rel of relations) {
    const { id1, id2 } = rel
    const label = extractLabel(rel.title)
    if (isStart(id1) && isStart(id2)) continue
    if (isEnd(id1) && isEnd(id2)) continue

    if (isStart(id1)) {
      // [*] --> X  ⇒  __start__ --> X
      if (nodesMap.has(id2)) {
        hasStartEdge = true
        edges.push({ source: '__start__', target: id2, label })
      }
      continue
    }
    if (isEnd(id2)) {
      // X --> [*]  ⇒  X --> __end__
      if (nodesMap.has(id1)) {
        hasEndEdge = true
        edges.push({ source: id1, target: '__end__', label })
      }
      continue
    }
    if (nodesMap.has(id1) && nodesMap.has(id2)) {
      edges.push({ source: id1, target: id2, label })
    }
  }

  if (hasStartEdge) {
    nodesMap.set('__start__', { id: '__start__', label: 'Start' })
  }
  if (hasEndEdge) {
    nodesMap.set('__end__', { id: '__end__', label: 'End' })
  }

  // 起始/终止节点排在首尾，保持画布上稳定的阅读顺序
  const nodes: ParsedNode[] = []
  const start = nodesMap.get('__start__')
  const end = nodesMap.get('__end__')
  if (start) nodes.push(start)
  for (const [id, node] of nodesMap) {
    if (id !== '__start__' && id !== '__end__') nodes.push(node)
  }
  if (end) nodes.push(end)

  return { nodes, edges }
}
