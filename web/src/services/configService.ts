import { apiClient } from './api'
import type { ApiResponse } from '@/types/api'

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
