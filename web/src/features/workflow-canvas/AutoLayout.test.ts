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

describe('autoLayout primary parent anchoring', () => {
  it('长下游和共享结束节点不会把节点拖离主父节点', async () => {
    const result = await autoLayout(
      [
        node('__start__'),
        node('Ensure'),
        node('Preclean'),
        node('LoadRef'),
        node('EmptyLatent'),
        node('LoadCkpt'),
        node('FaceAnalyze'),
        node('EncPos'),
        node('Apply'),
        node('SaveKps'),
        node('EncFix'),
        node('Sample0'),
        node('Decode0'),
        node('SaveOrig'),
        node('FaceMask'),
        node('Crop'),
        node('Upscale'),
        node('VaeEncode'),
        node('SampleFix'),
        node('UnloadSDXL'),
        node('LoadFixVae'),
        node('DecodeFix'),
        node('Downscale'),
        node('MaskCrop'),
        node('Composite'),
        node('Save'),
        node('Unload'),
        node('__end__'),
      ],
      [
        edge('__start__', 'Ensure'),
        edge('Ensure', 'Preclean'),
        edge('Ensure', 'LoadRef'),
        edge('Ensure', 'EmptyLatent'),
        edge('Preclean', 'LoadCkpt'),
        edge('LoadRef', 'FaceAnalyze'),
        edge('LoadCkpt', 'EncPos'),
        edge('LoadCkpt', 'Apply'),
        edge('LoadCkpt', 'EncFix'),
        edge('FaceAnalyze', 'Apply'),
        edge('FaceAnalyze', 'SaveKps'),
        edge('SaveKps', '__end__'),
        edge('EmptyLatent', 'Sample0'),
        edge('EncPos', 'Sample0'),
        edge('Apply', 'Sample0'),
        edge('Sample0', 'Decode0'),
        edge('Decode0', 'SaveOrig'),
        edge('SaveOrig', '__end__'),
        edge('Decode0', 'FaceMask'),
        edge('Decode0', 'Crop'),
        edge('FaceMask', 'Crop'),
        edge('Crop', 'Upscale'),
        edge('Upscale', 'VaeEncode'),
        edge('LoadCkpt', 'VaeEncode'),
        edge('VaeEncode', 'SampleFix'),
        edge('EncFix', 'SampleFix'),
        edge('SampleFix', 'UnloadSDXL'),
        edge('UnloadSDXL', 'LoadFixVae'),
        edge('LoadFixVae', 'DecodeFix'),
        edge('DecodeFix', 'Downscale'),
        edge('FaceMask', 'Downscale'),
        edge('FaceMask', 'MaskCrop'),
        edge('Decode0', 'Composite'),
        edge('Downscale', 'Composite'),
        edge('MaskCrop', 'Composite'),
        edge('Composite', 'Save'),
        edge('Save', 'Unload'),
        edge('Unload', '__end__'),
      ],
      { direction: 'TB' },
    )

    const x = (id: string) => result.nodes.find((item) => item.id === id)!.position.x

    expect(result.edges.every((item) => Array.isArray(item.data?.routePoints))).toBe(true)
    expect(Math.abs(x('SaveKps') - x('FaceAnalyze'))).toBeLessThan(140)
    expect(Math.abs(x('EncFix') - x('LoadCkpt'))).toBeLessThan(180)
    expect(Math.abs(x('EmptyLatent') - x('Ensure'))).toBeLessThan(180)
  })
})
