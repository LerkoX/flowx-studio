import { apiClient } from './api'
import type { ApiResponse } from '@/types/api'
import type { Workflow } from '@/types/workflow'
import type { ExecutionStatus, ExecutionNode } from '@/types/execution'

/**
 * 获取工作流列表
 * GET /api/v1/workflows
 */
export async function getWorkflows(params?: {
  status?: string
  search?: string
  page?: number
  page_size?: number
}): Promise<ApiResponse<{ items: Workflow[]; total: number; page: number; pageSize: number }>> {
  const response = await apiClient.get('/api/v1/workflows', { params })
  return response.data
}

/**
 * 获取工作流详情
 * GET /api/v1/workflows/:id
 */
export async function getWorkflow(workflowId: string): Promise<ApiResponse<Workflow>> {
  const response = await apiClient.get(`/api/v1/workflows/${workflowId}`)
  return response.data
}

/**
 * 创建工作流
 * POST /api/v1/workflows
 */
export async function createWorkflow(
  workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ApiResponse<Workflow>> {
  const response = await apiClient.post('/api/v1/workflows', workflow)
  return response.data
}

/**
 * 更新工作流
 * PUT /api/v1/workflows/:id
 */
export async function updateWorkflow(
  workflowId: string,
  workflow: Partial<Workflow>
): Promise<ApiResponse<{ id: number }>> {
  const response = await apiClient.put(`/api/v1/workflows/${workflowId}`, workflow)
  return response.data
}

/**
 * 删除工作流
 * DELETE /api/v1/workflows/:id
 */
export async function deleteWorkflow(
  workflowId: string
): Promise<ApiResponse<{ message: string }>> {
  const response = await apiClient.delete(`/api/v1/workflows/${workflowId}`)
  return response.data
}

/**
 * 执行工作流
 * POST /api/v1/workflows/:id/run
 */
export async function runWorkflow(
  workflowId: string,
  params?: Record<string, unknown>,
  dryRun = false
): Promise<
  ApiResponse<{
    executionId: number
    status: string
    streamUrl: string
  }>
> {
  const response = await apiClient.post(`/api/v1/workflows/${workflowId}/run`, {
    parameters: params,
    dry_run: dryRun,
  })
  return response.data
}

/**
 * 获取执行历史
 * GET /api/v1/executions
 */
export async function getExecutions(params?: {
  workflow_id?: number
  status?: string
  page?: number
  page_size?: number
}): Promise<ApiResponse<{ items: ExecutionStatus[]; total: number; page: number; pageSize: number }>> {
  const response = await apiClient.get('/api/v1/executions', { params })
  return response.data
}

/**
 * 获取执行详情
 * GET /api/v1/executions/:id
 */
export async function getExecution(executionId: string): Promise<ApiResponse<ExecutionStatus>> {
  const response = await apiClient.get(`/api/v1/executions/${executionId}`)
  return response.data
}

/**
 * 获取执行日志
 * GET /api/v1/executions/:id/logs
 */
export async function getExecutionNodes(
  executionId: string
): Promise<ApiResponse<ExecutionNode[]>> {
  const response = await apiClient.get(`/api/v1/executions/${executionId}/nodes`)
  return response.data
}

export async function getExecutionLogs(
  executionId: string,
  params?: {
    node_id?: string
    level?: string
    search?: string
    order?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }
): Promise<
  ApiResponse<{
    items: Array<{
      id: number
      execution_id: number
      node_id: string
      node_name: string
      level: string
      message: string
      output: string
      timestamp: string
    }>
    total: number
    limit: number
    offset: number
  }>
> {
  const response = await apiClient.get(`/api/v1/executions/${executionId}/logs`, { params })
  return response.data
}
