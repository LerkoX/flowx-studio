import { create } from 'zustand'
import type { Executor, ExecutorCreateInput, ExecutorUpdateInput } from '@/types/executor'
import {
  getExecutors,
  createExecutor,
  updateExecutor,
  deleteExecutor,
  setDefaultExecutor,
} from '@/services/executorService'

interface ExecutorState {
  executors: Executor[]
  isLoading: boolean
  error: string | null
  loadExecutors: () => Promise<void>
  create: (input: ExecutorCreateInput) => Promise<void>
  update: (id: number, input: ExecutorUpdateInput) => Promise<void>
  remove: (id: number) => Promise<void>
  setDefault: (id: number) => Promise<void>
}

export const useExecutorStore = create<ExecutorState>((set, get) => ({
  executors: [],
  isLoading: false,
  error: null,

  loadExecutors: async () => {
    set({ isLoading: true, error: null })
    try {
      const resp = await getExecutors()
      set({ executors: resp.data ?? [], isLoading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '加载执行器失败', isLoading: false })
    }
  },

  create: async (input) => {
    await createExecutor(input)
    await get().loadExecutors()
  },

  update: async (id, input) => {
    await updateExecutor(id, input)
    await get().loadExecutors()
  },

  remove: async (id) => {
    await deleteExecutor(id)
    await get().loadExecutors()
  },

  setDefault: async (id) => {
    await setDefaultExecutor(id)
    await get().loadExecutors()
  },
}))
