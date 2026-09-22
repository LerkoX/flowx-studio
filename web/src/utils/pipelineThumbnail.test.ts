import { describe, it, expect } from 'vitest'
import { buildThumbnailGraph, parseGraphSection, parseWorkflowDoc } from './pipelineThumbnail'

// 手写/示例文件常见形式：Graph 为块标量
const blockScalarYaml = `
Name: demo
Graph: |
  stateDiagram-v2
    [*] --> Build
    Build --> Test
    Test --> Deploy
    Deploy --> [*]
Nodes:
  Build: {executor: local}
  Test: {executor: local}
  Deploy: {executor: local}
`

// CLI/服务端 yaml 重编码后的形式：Graph 为带 \n 与行折叠的双引号标量
const quotedScalarYaml = `
Name: demo
Graph: "stateDiagram-v2\\n  [*] --> Ensure\\n  Ensure --> LoadImage\\n  LoadImage -->\\
  \\ Rotate\\n  Rotate --> [*]"
Nodes:
  Ensure: {config: {nodeRef: echo}}
  LoadImage: {config: {nodeRef: echo}}
  Rotate: {config: {nodeRef: echo}}
`

describe('pipelineThumbnail', () => {
  it('extracts Graph from a block scalar', () => {
    const { graph } = parseWorkflowDoc(blockScalarYaml)
    expect(graph).toContain('stateDiagram-v2')
    expect(graph).toContain('Build --> Test')
  })

  it('extracts Graph from a folded double-quoted scalar', () => {
    const { graph, nodes } = parseWorkflowDoc(quotedScalarYaml)
    expect(graph).toContain('Ensure --> LoadImage')
    // 行折叠后的 \ 续行必须还原成同一行
    expect(graph).toContain('LoadImage --> Rotate')
    expect(nodes).toEqual(['Ensure', 'LoadImage', 'Rotate'])
  })

  it('parses transitions including terminal markers (filtered later)', () => {
    const { edges } = parseGraphSection(parseWorkflowDoc(blockScalarYaml).graph)
    expect(edges).toEqual([
      { source: '[*]', target: 'Build' },
      { source: 'Build', target: 'Test' },
      { source: 'Test', target: 'Deploy' },
      { source: 'Deploy', target: '[*]' },
    ])
  })

  it('builds a readable thumbnail without mermaid', () => {
    const graph = buildThumbnailGraph(blockScalarYaml)
    expect(graph).not.toBeNull()
    expect(graph!.nodes.map((n) => n.id)).toEqual(['Build', 'Test', 'Deploy'])
    // 线性链：层号递增 ⇒ x 递增
    const [build, test, deploy] = graph!.nodes
    expect(build.x).toBeLessThan(test.x)
    expect(test.x).toBeLessThan(deploy.x)
    expect(graph!.edges).toHaveLength(2)
    // 起止伪状态不进入缩略图
    expect(graph!.edges.every((e) => !e.id.includes('[*]'))).toBe(true)
    expect(graph!.viewBox.startsWith('0 0 ')).toBe(true)
  })

  it('works on CLI-encoded Graph (regression: 折叠标量) ', () => {
    const graph = buildThumbnailGraph(quotedScalarYaml)
    expect(graph!.nodes.map((n) => n.id)).toEqual(['Ensure', 'LoadImage', 'Rotate'])
    expect(graph!.edges).toHaveLength(2)
  })

  it('uses state descriptions as labels and truncates long ones', () => {
    const y = `
Name: demo
Graph: |
  stateDiagram-v2
    [*] --> A
    A : 拉取数据并做一次很长的处理
    state "短标签" as B
    A --> B
    B --> [*]
`
    const graph = buildThumbnailGraph(y)
    const labels = Object.fromEntries(graph!.nodes.map((n) => [n.id, n.label]))
    expect(labels.B).toBe('短标签')
    expect(labels.A.endsWith('…')).toBe(true)
  })

  it('keeps Nodes entries that no edge references', () => {
    const y = `
Name: demo
Graph: |
  stateDiagram-v2
    a --> b
Nodes:
  a: {}
  b: {}
  orphan: {}
`
    const graph = buildThumbnailGraph(y)
    expect(graph!.nodes.map((n) => n.id)).toEqual(['a', 'b', 'orphan'])
  })

  it('falls back to Nodes section when Graph has no transitions', () => {
    const y = `
Name: demo
Graph: |
  stateDiagram-v2
Nodes:
  only:
    config:
      nodeRef: echo
`
    const graph = buildThumbnailGraph(y)
    expect(graph?.nodes.map((n) => n.id)).toEqual(['only'])
    expect(graph?.edges).toEqual([])
  })

  it('terminates on cycles (loop back edge)', () => {
    const y = `
Name: demo
Graph: |
  stateDiagram-v2
    [*] --> a
    a --> b
    b --> c
    c --> a: {{ iteration < 3 }}
    c --> d
    d --> [*]
`
    const graph = buildThumbnailGraph(y)
    expect(graph!.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns null for configs without graph or nodes', () => {
    expect(buildThumbnailGraph('Name: empty')).toBeNull()
    expect(buildThumbnailGraph('not: [valid')).toBeNull()
  })
})
