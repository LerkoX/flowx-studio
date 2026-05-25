import { create } from 'zustand'
import type { Workflow } from '@/types/workflow'

interface WorkflowState {
  currentWorkflow: Workflow | null
  workflows: Workflow[]
  nodeStatuses: Record<string, string>
  setCurrentWorkflow: (workflow: Workflow | null) => void
  addWorkflow: (workflow: Workflow) => void
  updateNodeStatus: (nodeId: string, status: string) => void
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
  setCurrentWorkflow: (workflow) => set({ currentWorkflow: workflow }),
  addWorkflow: (workflow) => set((state) => ({
    workflows: [...state.workflows, workflow],
  })),
  updateNodeStatus: (nodeId, status) => set((state) => ({
    nodeStatuses: { ...state.nodeStatuses, [nodeId]: status },
  })),
}))
