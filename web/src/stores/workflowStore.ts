import { create } from 'zustand'
import type { Workflow, PipelineParam, NodeRuntimeData } from '@/types/workflow'
import yaml from 'js-yaml'

interface WorkflowState {
  currentWorkflow: Workflow | null
  workflows: Workflow[]
  nodeStatuses: Record<string, string>
  params: Record<string, PipelineParam>
  nodeRuntimeData: Record<string, NodeRuntimeData>
  setCurrentWorkflow: (workflow: Workflow | null) => void
  addWorkflow: (workflow: Workflow) => void
  updateNodeStatus: (nodeId: string, status: string) => void
  syncParamsFromYAML: (yamlConfig: string) => void
  updateParam: (key: string, value: string | number | boolean | object) => void
  setNodeRuntimeData: (nodeId: string, data: Partial<NodeRuntimeData>) => void
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

  updateNodeStatus: (nodeId, status) => set((state) => ({
    nodeStatuses: { ...state.nodeStatuses, [nodeId]: status },
  })),

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
}))
