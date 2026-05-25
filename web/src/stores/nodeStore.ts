import { create } from 'zustand'
import type { NodeDefinition } from '@/types/node'

interface NodeState {
  currentNode: NodeDefinition | null
  nodes: NodeDefinition[]
  setCurrentNode: (node: NodeDefinition | null) => void
  addNode: (node: NodeDefinition) => void
}

export const useNodeStore = create<NodeState>((set) => ({
  currentNode: {
    id: 'demo-node',
    name: 'DemoProcessor',
    description: '示例数据处理节点，支持多种数据格式转换',
    language: 'go',
    icon: '⚙️',
    parameters: [
      {
        name: 'inputFormat',
        type: 'string',
        description: '输入数据格式 (json, yaml, csv)',
        required: true,
      },
      {
        name: 'outputFormat',
        type: 'string',
        description: '输出数据格式',
        required: true,
      },
      {
        name: 'schema',
        type: 'object',
        description: '数据验证 schema',
        required: false,
      },
    ],
    mockResult: {
      status: 'success',
      processed: 1024,
      duration: '45ms',
      output: {
        format: 'json',
        records: 1024,
      },
    },
  },
  nodes: [],
  setCurrentNode: (node) => set({ currentNode: node }),
  addNode: (node) => set((state) => ({
    nodes: [...state.nodes, node],
  })),
}))
