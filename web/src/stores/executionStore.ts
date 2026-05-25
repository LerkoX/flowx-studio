import { create } from 'zustand'

interface ExecutionState {
  isExecuting: boolean
  executionLog: string[]
  currentExecutionId: string | null
  startExecution: (id: string) => void
  stopExecution: () => void
  appendLog: (message: string) => void
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  isExecuting: false,
  executionLog: [],
  currentExecutionId: null,
  startExecution: (id) => set({ isExecuting: true, currentExecutionId: id, executionLog: [] }),
  stopExecution: () => set({ isExecuting: false, currentExecutionId: null }),
  appendLog: (message) => set((state) => ({
    executionLog: [...state.executionLog, message],
  })),
}))
