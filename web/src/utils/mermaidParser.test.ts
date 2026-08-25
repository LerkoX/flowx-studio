import { describe, it, expect } from 'vitest'
import { parseWorkflowGraph } from './mermaidParser'

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
