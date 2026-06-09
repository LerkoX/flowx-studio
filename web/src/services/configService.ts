import { apiClient } from './api'
import type { ApiResponse } from '@/types/api'
import type { AIProviderConfig, MCPConfig } from '@/types/settings'

// ========== AI Config ==========

export async function getAIConfigs(): Promise<ApiResponse<AIProviderConfig[]>> {
  const response = await apiClient.get('/api/v1/config/ai')
  return response.data
}

export async function createAIConfig(
  config: Omit<AIProviderConfig, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ApiResponse<AIProviderConfig>> {
  const response = await apiClient.post('/api/v1/config/ai', config)
  return response.data
}

export async function updateAIConfig(
  id: string,
  config: Partial<AIProviderConfig>
): Promise<ApiResponse<{ id: number }>> {
  const response = await apiClient.put(`/api/v1/config/ai/${id}`, config)
  return response.data
}

export async function deleteAIConfig(id: string): Promise<ApiResponse<{ message: string }>> {
  const response = await apiClient.delete(`/api/v1/config/ai/${id}`)
  return response.data
}

export async function testAIConfig(
  id: string
): Promise<
  ApiResponse<{
    success: boolean
    latency_ms: number
    model: string
    response: string
  }>
> {
  const response = await apiClient.post(`/api/v1/config/ai/${id}/test`)
  return response.data
}

// ========== MCP Config ==========

export async function getMCPConfigs(): Promise<ApiResponse<MCPConfig[]>> {
  const response = await apiClient.get('/api/v1/config/mcp')
  return response.data
}

export async function createMCPConfig(
  config: Omit<MCPConfig, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ApiResponse<MCPConfig>> {
  const response = await apiClient.post('/api/v1/config/mcp', config)
  return response.data
}

export async function updateMCPConfig(
  id: string,
  config: Partial<MCPConfig>
): Promise<ApiResponse<{ id: number }>> {
  const response = await apiClient.put(`/api/v1/config/mcp/${id}`, config)
  return response.data
}

export async function deleteMCPConfig(id: string): Promise<ApiResponse<{ message: string }>> {
  const response = await apiClient.delete(`/api/v1/config/mcp/${id}`)
  return response.data
}

export async function testMCPConfig(
  id: string
): Promise<
  ApiResponse<{
    success: boolean
    mode: string
    status: string
    message: string
  }>
> {
  const response = await apiClient.post(`/api/v1/config/mcp/${id}/test`)
  return response.data
}

// ========== MCP Connection Management ==========

export async function getMCPConnections(): Promise<
  ApiResponse<
    {
      id: number
      name: string
      mode: string
      is_enabled: boolean
      status: string
      last_error: string
      tools_count: number
    }[]
  >
> {
  const response = await apiClient.get('/api/v1/mcp/connections')
  return response.data
}

export async function connectMCP(id: string): Promise<
  ApiResponse<{
    id: number
    status: string
    message: string
  }>
> {
  const response = await apiClient.post(`/api/v1/mcp/${id}/connect`)
  return response.data
}

export async function disconnectMCP(id: string): Promise<
  ApiResponse<{
    id: number
    status: string
    message: string
  }>
> {
  const response = await apiClient.post(`/api/v1/mcp/${id}/disconnect`)
  return response.data
}

export async function getMCPStatus(id: string): Promise<
  ApiResponse<{
    id: number
    status: string
    connected: boolean
    last_error: string
    tools_count: number
  }>
> {
  const response = await apiClient.get(`/api/v1/mcp/${id}/status`)
  return response.data
}

export async function getMCPTools(id: string): Promise<
  ApiResponse<
    {
      name: string
      description: string
      parameters: Record<string, unknown>
    }[]
  >
> {
  const response = await apiClient.get(`/api/v1/mcp/${id}/tools`)
  return response.data
}

export async function callMCPTool(
  id: string,
  toolName: string,
  parameters: Record<string, unknown>
): Promise<
  ApiResponse<{
    success: boolean
    result: Record<string, unknown>
    error: string
  }>
> {
  const response = await apiClient.post(`/api/v1/mcp/${id}/tools/${toolName}/call`, {
    parameters,
  })
  return response.data
}

// ========== System Config ==========

export async function getSystemConfig(): Promise<ApiResponse<Record<string, string>>> {
  const response = await apiClient.get('/api/v1/config/system')
  return response.data
}

export async function updateSystemConfig(
  settings: Record<string, string>
): Promise<ApiResponse<{ message: string }>> {
  const response = await apiClient.put('/api/v1/config/system', settings)
  return response.data
}
