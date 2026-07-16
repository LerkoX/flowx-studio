import { apiClient } from './api'
import type { ApiResponse } from '@/types/api'
import type { NodeDefinition } from '@/types/node'

/**
 * 获取节点列表
 * GET /api/v1/nodes
 */
export async function getNodes(params?: {
  language?: string
  tag?: string
  search?: string
  node_type?: string
  page?: number
  page_size?: number
}): Promise<ApiResponse<{ items: NodeDefinition[]; total: number; page: number; pageSize: number }>> {
  const response = await apiClient.get('/api/v1/nodes', { params })
  return response.data
}

/**
 * 获取节点详情
 * GET /api/v1/nodes/:id
 */
export async function getNode(nodeId: string): Promise<ApiResponse<NodeDefinition>> {
  const response = await apiClient.get(`/api/v1/nodes/${nodeId}`)
  return response.data
}

/**
 * 创建节点
 * POST /api/v1/nodes
 */
export async function createNode(
  node: Omit<NodeDefinition, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ApiResponse<NodeDefinition>> {
  const response = await apiClient.post('/api/v1/nodes', node)
  return response.data
}

/**
 * 更新节点
 * PUT /api/v1/nodes/:id
 */
export async function updateNode(
  nodeId: string,
  node: Partial<NodeDefinition>
): Promise<ApiResponse<{ id: number }>> {
  const response = await apiClient.put(`/api/v1/nodes/${nodeId}`, node)
  return response.data
}

/**
 * 删除节点
 * DELETE /api/v1/nodes/:id
 */
export async function deleteNode(nodeId: string): Promise<ApiResponse<{ message: string }>> {
  const response = await apiClient.delete(`/api/v1/nodes/${nodeId}`)
  return response.data
}

/**
 * 导入节点
 * POST /api/v1/nodes/import
 */
export async function importNode(data: {
  source_type: 'git' | 'folder'
  source_url?: string
  source_path?: string
}): Promise<ApiResponse<NodeDefinition>> {
  const response = await apiClient.post('/api/v1/nodes/import', data)
  return response.data
}

/**
 * Mock 测试节点
 * POST /api/v1/nodes/:id/mock
 */
export async function mockTestNode(
  nodeId: string,
  parameters?: Record<string, string>,
  timeout?: number
): Promise<
  ApiResponse<{
    status: string
    duration_ms: number
    output: Record<string, unknown>
    stdout: string
    stderr: string
    logs: string
    error: string
    exit_code: number
  }>
> {
  const response = await apiClient.post(`/api/v1/nodes/${nodeId}/mock`, { parameters, timeout })
  return response.data
}
