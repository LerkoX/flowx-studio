export interface PipelineParam {
  key: string
  value: string | number | boolean | object
  description?: string
  originalValue: string | number | boolean | object
}

export interface NodeRuntimeData {
  nodeId: string
  inputs: string[]
  outputs: Record<string, string>
  status: string
  startTime?: string
  endTime?: string
}

export interface Workflow {
  id: string
  name: string
  description?: string
  yamlConfig: string
  status: 'idle' | 'running' | 'success' | 'failed' | 'paused'
  createdAt: Date
  updatedAt: Date
}
