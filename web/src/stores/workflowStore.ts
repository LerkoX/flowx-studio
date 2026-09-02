import { create } from 'zustand'
import type { Workflow, PipelineParam, NodeRuntimeData } from '@/types/workflow'
import yaml from 'js-yaml'

interface WorkflowState {
  currentWorkflow: Workflow | null
  workflows: Workflow[]
  nodeStatuses: Record<string, string>
  // 节点完成时间戳（客户端收到 node_complete 的时间），用于判断运行中节点的
  // 哪条入边真正触发了本轮执行（循环图中区分正向边与回边）
  nodeCompletedAt: Record<string, number>
  // 节点本轮启动前的上次完成时间（node_start 时从 nodeCompletedAt 快照）
  nodePrevCompletedAt: Record<string, number>
  params: Record<string, PipelineParam>
  nodeRuntimeData: Record<string, NodeRuntimeData>
  setCurrentWorkflow: (workflow: Workflow | null) => void
  addWorkflow: (workflow: Workflow) => void
  updateNodeStatus: (nodeId: string, status: string) => void
  setNodeStatuses: (statuses: Record<string, string>) => void
  syncParamsFromYAML: (yamlConfig: string) => void
  updateParam: (key: string, value: string | number | boolean | object) => void
  setNodeRuntimeData: (nodeId: string, data: Partial<NodeRuntimeData>) => void
  resetNodeRuntimeData: () => void
}

function parseParamValue(v: unknown): { value: unknown; description?: string } {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>
    if ('value' in obj) {
      return {
        value: obj.value,
        description: obj.description as string | undefined,
      }
    }
  }
  return { value: v }
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  currentWorkflow: null,
  workflows: [],
  nodeStatuses: {
    start: 'success',
    build: 'running',
    test: 'idle',
    deploy: 'idle',
  },
  nodeCompletedAt: {},
  nodePrevCompletedAt: {},
  params: {},
  nodeRuntimeData: {
    build: {
      nodeId: 'build',
      inputs: ['env', 'appName'],
      outputs: {
        imageTag: 'myapp:v1.0.0',
        buildStatus: 'success',
      },
      status: 'running',
      startTime: new Date().toISOString(),
    },
    test: {
      nodeId: 'test',
      inputs: ['env'],
      outputs: {},
      status: 'idle',
    },
    deploy: {
      nodeId: 'deploy',
      inputs: ['env', 'namespace'],
      outputs: {},
      status: 'idle',
    },
    start: {
      nodeId: 'start',
      inputs: [],
      outputs: {},
      status: 'success',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
    },
  },

  setCurrentWorkflow: (workflow) => set({ currentWorkflow: workflow }),

  addWorkflow: (workflow) => set((state) => ({
    workflows: [...state.workflows, workflow],
  })),

  updateNodeStatus: (nodeId, status) => set((state) => {
    if (status === 'running') {
      // 本轮启动：快照上次完成时间，供入边判断本轮前驱
      return {
        nodeStatuses: { ...state.nodeStatuses, [nodeId]: status },
        nodePrevCompletedAt: {
          ...state.nodePrevCompletedAt,
          [nodeId]: state.nodeCompletedAt[nodeId] ?? 0,
        },
      }
    }
    // 循环迭代中上游已终结节点会被跳过并再次触发 node_complete（无对应 node_start）；
    // 仅真实运行（running → 终态）才刷新完成时间，否则跳过事件会污染入边高亮判断
    if (state.nodeStatuses[nodeId] !== 'running') {
      return { nodeStatuses: { ...state.nodeStatuses, [nodeId]: status } }
    }
    return {
      nodeStatuses: { ...state.nodeStatuses, [nodeId]: status },
      nodeCompletedAt: { ...state.nodeCompletedAt, [nodeId]: Date.now() },
    }
  }),

  // 整体重置状态（新执行开始/切换历史执行）时一并清空时间戳，
  // 画布高亮在无时间戳数据时回退为「目标节点运行即亮」
  setNodeStatuses: (statuses) => set({
    nodeStatuses: statuses,
    nodeCompletedAt: {},
    nodePrevCompletedAt: {},
  }),

  syncParamsFromYAML: (yamlConfig: string) => {
    try {
      const doc = yaml.load(yamlConfig) as Record<string, unknown> | undefined
      if (!doc || !doc.Param) {
        set({ params: {} })
        return
      }
      const paramMap = doc.Param as Record<string, unknown>
      const params: Record<string, PipelineParam> = {}
      for (const [key, val] of Object.entries(paramMap)) {
        const parsed = parseParamValue(val)
        params[key] = {
          key,
          value: parsed.value as string | number | boolean | object,
          description: parsed.description,
          originalValue: parsed.value as string | number | boolean | object,
        }
      }
      set({ params })
    } catch {
      set({ params: {} })
    }
  },

  updateParam: (key, value) => {
    set((state) => {
      const param = state.params[key]
      if (!param) return state

      const updatedParams = {
        ...state.params,
        [key]: { ...param, value },
      }

      // Sync back to YAML if workflow exists
      const workflow = state.currentWorkflow
      if (workflow) {
        try {
          const doc = yaml.load(workflow.yamlConfig) as Record<string, unknown> | undefined
          if (doc && doc.Param) {
            const paramMap = doc.Param as Record<string, unknown>
            const existing = parseParamValue(paramMap[key])
            if (existing.description) {
              paramMap[key] = {
                value,
                description: existing.description,
              }
            } else {
              paramMap[key] = value
            }
            const newYaml = yaml.dump(doc)
            const updatedWorkflow = { ...workflow, yamlConfig: newYaml }
            return {
              params: updatedParams,
              currentWorkflow: updatedWorkflow,
              workflows: state.workflows.map((w) =>
                w.id === workflow.id ? updatedWorkflow : w
              ),
            }
          }
        } catch {
          // ignore YAML parse errors
        }
      }

      return { params: updatedParams }
    })
  },

  setNodeRuntimeData: (nodeId, data) => {
    set((state) => ({
      nodeRuntimeData: {
        ...state.nodeRuntimeData,
        [nodeId]: {
          ...state.nodeRuntimeData[nodeId],
          nodeId,
          ...data,
        } as NodeRuntimeData,
      },
    }))
  },

  resetNodeRuntimeData: () => set({ nodeRuntimeData: {} }),
}))
