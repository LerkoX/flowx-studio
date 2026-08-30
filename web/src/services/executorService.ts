import { apiClient } from './api'
import type { ApiResponse } from '@/types/api'
import type { Executor, ExecutorCreateInput, ExecutorUpdateInput } from '@/types/executor'

/**
 * 列出执行器实例
 * GET /api/v1/executors
 */
export async function getExecutors(): Promise<ApiResponse<Executor[]>> {
  const response = await apiClient.get('/api/v1/executors')
  return response.data
}

/**
 * 创建执行器实例（local 仅允许一个；type 仅支持 local/docker）
 * POST /api/v1/executors
 */
export async function createExecutor(
  input: ExecutorCreateInput
): Promise<ApiResponse<Executor>> {
  const response = await apiClient.post('/api/v1/executors', input)
  return response.data
}

/**
 * 更新执行器（名称与类型不可变更）
 * PUT /api/v1/executors/:id
 */
export async function updateExecutor(
  id: number,
  input: ExecutorUpdateInput
): Promise<ApiResponse<{ id: number }>> {
  const response = await apiClient.put(`/api/v1/executors/${id}`, input)
  return response.data
}

/**
 * 删除执行器（默认执行器禁止删除）
 * DELETE /api/v1/executors/:id
 */
export async function deleteExecutor(id: number): Promise<ApiResponse<{ message: string }>> {
  const response = await apiClient.delete(`/api/v1/executors/${id}`)
  return response.data
}

/**
 * 设为全局默认执行器
 * PUT /api/v1/executors/:id/default
 */
export async function setDefaultExecutor(id: number): Promise<ApiResponse<Executor>> {
  const response = await apiClient.put(`/api/v1/executors/${id}/default`)
  return response.data
}
