export interface Workflow {
  id: string
  name: string
  description?: string
  yamlConfig: string
  status: 'idle' | 'running' | 'success' | 'failed' | 'paused'
  createdAt: Date
  updatedAt: Date
}
