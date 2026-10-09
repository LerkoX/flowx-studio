import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { autoLayout } from './AutoLayout'

const node = (id: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
})

const edge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
})

describe('autoLayout edge routing', () => {
  it('TB 长连线穿过中间节点时增加绕行控制偏移', () => {
    const result = autoLayout(
      [node('A'), node('B'), node('C')],
      [edge('A', 'B'), edge('B', 'C'), edge('A', 'C')],
      { direction: 'TB' },
    )

    const longEdge = result.edges.find((item) => item.id === 'A->C')
    const directEdge = result.edges.find((item) => item.id === 'A->B')

    expect(longEdge?.data?.controlOffset).toBeTypeOf('number')
    expect(longEdge?.data?.controlOffset).not.toBe(0)
    expect(directEdge?.data?.controlOffset).toBeUndefined()
  })

  it('LR 长连线穿过中间节点时增加绕行控制偏移', () => {
    const result = autoLayout(
      [node('A'), node('B'), node('C')],
      [edge('A', 'B'), edge('B', 'C'), edge('A', 'C')],
      { direction: 'LR' },
    )

    const longEdge = result.edges.find((item) => item.id === 'A->C')

    expect(longEdge?.data?.controlOffset).toBeTypeOf('number')
    expect(longEdge?.data?.controlOffset).not.toBe(0)
  })
})
