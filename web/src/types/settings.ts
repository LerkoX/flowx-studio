export interface AIProviderConfig {
  id: string
  name: string
  providerType: 'openai' | 'anthropic' | 'ollama' | 'custom'
  apiKey?: string
  baseURL?: string
  model: string
  temperature: number
  maxTokens?: number
  isActive: boolean
  isEnabled: boolean
}

export interface MCPConfig {
  id: string
  name: string
  // 本地命令模式 | 远程 SSE 模式
  mode: 'local' | 'remote'
  // 本地模式字段
  command?: string
  args?: string[]
  env?: Record<string, string>
  // 远程模式字段
  url?: string
  authHeaderKey?: string
  authHeaderValue?: string
  // 通用字段
  isEnabled: boolean
  status: 'connected' | 'disconnected' | 'error'
  lastError?: string
}

export interface SystemSettings {
  theme: 'dark' | 'light' | 'system'
  language: string
  autoSave: boolean
  autoSaveInterval: number
  showNotifications: boolean
  confirmBeforeDelete: boolean
  defaultNodeTimeout: number
  maxConcurrentExecutions: number
  logRetentionDays: number
}
