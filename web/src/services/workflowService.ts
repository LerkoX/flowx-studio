import type { ApiResponse } from '@/types/api'

// TODO: import axios and create apiClient when backend is ready
// import axios from 'axios'
// import { API_BASE_URL } from '@/utils/constants'
// const apiClient = axios.create({
//   baseURL: API_BASE_URL,
//   headers: { 'Content-Type': 'application/json' },
// })

/**
 * 更新流水线参数
 * PUT /api/v1/workflows/:id/config
 */
export async function updateWorkflowParams(
  workflowId: string,
  params: Record<string, string>
): Promise<ApiResponse<void>> {
  // TODO: 后端 API 实现后移除 mock
  console.log('[Mock API] updateWorkflowParams:', { workflowId, params })

  // Mock: 模拟网络延迟
  await new Promise((resolve) => setTimeout(resolve, 500))

  // 实际实现（后端就绪后启用）:
  // const response = await api.put(`/api/v1/workflows/${workflowId}/config`, {
  //   param: params,
  // })
  // return response.data

  return {
    code: 200,
    message: 'success',
    data: undefined,
  }
}

/**
 * 获取流水线配置
 * GET /api/v1/workflows/:id
 */
export async function getWorkflow(workflowId: string): Promise<ApiResponse<unknown>> {
  // TODO: 后端 API 实现后移除 mock
  console.log('[Mock API] getWorkflow:', workflowId)

  await new Promise((resolve) => setTimeout(resolve, 300))

  // const response = await api.get(`/api/v1/workflows/${workflowId}`)
  // return response.data

  return {
    code: 200,
    message: 'success',
    data: {},
  }
}

/**
 * 执行流水线
 * POST /api/v1/workflows/:id/run
 */
export async function runWorkflow(
  workflowId: string,
  params?: Record<string, unknown>,
  dryRun = false
): Promise<ApiResponse<{ executionId: string; status: string; streamUrl: string }>> {
  // TODO: 后端 API 实现后移除 mock
  console.log('[Mock API] runWorkflow:', { workflowId, params, dryRun })

  await new Promise((resolve) => setTimeout(resolve, 800))

  // const response = await api.post(`/api/v1/workflows/${workflowId}/run`, {
  //   parameters: params,
  //   dry_run: dryRun,
  // })
  // return response.data

  return {
    code: 200,
    message: 'Workflow execution started',
    data: {
      executionId: `exec_${Date.now()}`,
      status: 'running',
      streamUrl: `/api/v1/executions/exec_${Date.now()}/stream`,
    },
  }
}

/**
 * 获取执行详情
 * GET /api/v1/executions/:id
 */
export async function getExecution(
  executionId: string
): Promise<ApiResponse<unknown>> {
  console.log('[Mock API] getExecution:', executionId)

  await new Promise((resolve) => setTimeout(resolve, 300))

  return {
    code: 200,
    message: 'success',
    data: {},
  }
}
