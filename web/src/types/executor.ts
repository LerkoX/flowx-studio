// 执行器实例（与后端 model.Executor 对应）
export type ExecutorType = 'local' | 'docker'

export interface Executor {
  id: number
  name: string
  type: ExecutorType
  description?: string
  config: Record<string, unknown>
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface ExecutorCreateInput {
  name: string
  type: ExecutorType
  description?: string
  config: Record<string, unknown>
}

export interface ExecutorUpdateInput {
  description?: string
  config?: Record<string, unknown>
}
