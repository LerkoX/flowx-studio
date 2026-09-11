import { describe, it, expect } from 'vitest'
import { parseWorkflowGraph, parseNodeRefs, parseParamSources } from './mermaidParser'

const yamlConfig = `
Name: demo
Graph: |
  stateDiagram-v2
    [*] --> Build
    Build --> Test
    Test --> Deploy
    Deploy --> [*]
Nodes:
  Build: {executor: local}
`

describe('parseWorkflowGraph (official mermaid parser)', () => {
  it('extracts nodes and edges with start/end terminals', async () => {
    const { nodes, edges } = await parseWorkflowGraph(yamlConfig)
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('__start__')
    expect(ids).toContain('Build')
    expect(ids).toContain('Test')
    expect(ids).toContain('Deploy')
    expect(ids).toContain('__end__')
    expect(edges).toContainEqual({ source: '__start__', target: 'Build' })
    expect(edges).toContainEqual({ source: 'Build', target: 'Test' })
    expect(edges).toContainEqual({ source: 'Test', target: 'Deploy' })
    expect(edges).toContainEqual({ source: 'Deploy', target: '__end__' })
  })

  it('supports state descriptions as labels', async () => {
    const y = `
Name: demo
Graph: |
  stateDiagram-v2
    [*] --> A
    A : 拉取数据
    A --> [*]
`
    const { nodes } = await parseWorkflowGraph(y)
    expect(nodes.find((n) => n.id === 'A')?.label).toBe('拉取数据')
  })

  it('throws on non-stateDiagram graph', async () => {
    const y = 'Name: demo\nGraph: |\n  flowchart LR\n    A --> B\n'
    await expect(parseWorkflowGraph(y)).rejects.toThrow('stateDiagram')
  })

  it('throws on missing Graph section', async () => {
    await expect(parseWorkflowGraph('Name: demo')).rejects.toThrow('Graph')
  })

  it('keeps nodes actually named start/end (not confused with [*])', async () => {
    const y = `
Name: demo
Graph: |
  stateDiagram-v2
    [*] --> start
    start --> [*]
`
    const { nodes, edges } = await parseWorkflowGraph(y)
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('start') // 真实节点保留
    expect(ids).toContain('__start__')
    expect(ids).toContain('__end__')
    expect(edges).toContainEqual({ source: '__start__', target: 'start' })
    expect(edges).toContainEqual({ source: 'start', target: '__end__' })
  })
})

describe('parseNodeRefs', () => {
  it('提取各节点实例的 nodeRef', () => {
    const yaml = `
Name: demo
Graph: |
  stateDiagram-v2
    [*] --> GetWeather
    GetWeather --> Notify
Nodes:
  GetWeather:
    name: 获取天气
    config:
      nodeRef: get-weather
      params:
        city: 深圳
  Notify:
    name: 通知
    config:
      nodeRef: send-feishu
`
    expect(parseNodeRefs(yaml)).toEqual({
      GetWeather: 'get-weather',
      Notify: 'send-feishu',
    })
  })

  it('缺少 nodeRef 或 Nodes 时返回空对象', () => {
    expect(parseNodeRefs('Name: x\nGraph: |\n  stateDiagram-v2\n    [*] --> A\n')).toEqual({})
    expect(parseNodeRefs('invalid: [yaml')).toEqual({})
    expect(parseNodeRefs('')).toEqual({})
  })

  it('兼容节点直挂 nodeRef 的形式', () => {
    const yaml = `
Nodes:
  A:
    nodeRef: some-node
`
    expect(parseNodeRefs(yaml)).toEqual({ A: 'some-node' })
  })
})

describe('parseParamSources', () => {
  const yaml = `
Name: sd
Param:
  seed: -1
  prompt:
    value: a cat
    description: 提示词
  token: ''
Graph: |
  stateDiagram-v2
    [*] --> Ensure
    Ensure --> KSampler
Nodes:
  Ensure:
    name: 服务健康检查
    config:
      nodeRef: inference-ensure@1.0.0
      params:
        service_url: '{{ Param.service_url }}'
        wait_seconds: 60
  KSampler:
    name: KSampler采样
    config:
      nodeRef: ksampler@1.0.0
      params:
        seed: '{{ Param.seed }}'
        prompt: '{{ Param.prompt }}'
        token: '{{ Param.token }}'
        missing: '{{ Param.not_defined }}'
        service_url: '{{ Ensure.service_url }}'
        nested: '{{ Ensure.a.b }}'
        filtered: '{{ Param.seed | default(1) }}'
        steps: 20
        mixed: 'prefix {{ Param.seed }} suffix'
`

  it('识别流水线参数引用并附当前值', () => {
    const sources = parseParamSources(yaml)
    expect(sources.KSampler.seed).toEqual({ kind: 'workflow', paramName: 'seed', paramValue: '-1' })
    expect(sources.KSampler.steps).toEqual({ kind: 'literal' })
  })

  it('解包 { value, description } 形式的流水线参数', () => {
    const sources = parseParamSources(yaml)
    expect(sources.KSampler.prompt).toEqual({ kind: 'workflow', paramName: 'prompt', paramValue: 'a cat' })
  })

  it('空字符串参数值正常下发', () => {
    const sources = parseParamSources(yaml)
    expect(sources.KSampler.token).toEqual({ kind: 'workflow', paramName: 'token', paramValue: '' })
  })

  it('引用未定义的流水线参数时 paramValue 缺省', () => {
    const sources = parseParamSources(yaml)
    expect(sources.KSampler.missing).toEqual({ kind: 'workflow', paramName: 'not_defined' })
    expect(sources.KSampler.missing.paramValue).toBeUndefined()
  })

  it('识别节点引用并附节点显示名', () => {
    const sources = parseParamSources(yaml)
    expect(sources.KSampler.service_url).toEqual({
      kind: 'node',
      nodeId: 'Ensure',
      nodeName: '服务健康检查',
      field: 'service_url',
    })
  })

  it('节点引用支持嵌套字段路径', () => {
    const sources = parseParamSources(yaml)
    expect(sources.KSampler.nested).toMatchObject({ kind: 'node', nodeId: 'Ensure', field: 'a.b' })
  })

  it('剥离模板过滤器', () => {
    const sources = parseParamSources(yaml)
    expect(sources.KSampler.filtered).toEqual({ kind: 'workflow', paramName: 'seed', paramValue: '-1' })
  })

  it('混合文本（多模板/拼接）按字面值处理', () => {
    const sources = parseParamSources(yaml)
    expect(sources.KSampler.mixed).toEqual({ kind: 'literal' })
  })

  it('数字字面值统一转 string 判定为 literal', () => {
    const sources = parseParamSources(yaml)
    expect(sources.Ensure.wait_seconds).toEqual({ kind: 'literal' })
  })

  it('非法 YAML 返回空对象', () => {
    expect(parseParamSources('invalid: [yaml')).toEqual({})
    expect(parseParamSources('')).toEqual({})
  })
})
