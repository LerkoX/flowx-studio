import axios from 'axios'
import type { ApiResponse } from '@/types/api'

const API_BASE_URL = '' // 使用相对路径，同源部署

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// 统一响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    const data = response.data as ApiResponse<unknown>
    if (data.code !== 200) {
      return Promise.reject(new Error(data.message || 'Request failed'))
    }
    return response
  },
  (error) => {
    const message = error.response?.data?.message || error.message || 'Network error'
    return Promise.reject(new Error(message))
  }
)
