export interface WorkflowParam {
  key: string
  value: string | number | boolean | object
  description?: string
  originalValue: string | number | boolean | object
}

export interface NodePreview {
  /** base64 编码的预览图像帧 */
  image: string
  /** 图像媒体类型（image/jpeg、image/png 等） */
  mime: string
  /** 可选进度 0~1 */
  progress?: number
}

export interface NodeRuntimeData {
  nodeId: string
  inputs: string[]
  outputs: Record<string, string>
  status: string
  startTime?: string
  endTime?: string
  /** 节点运行中推送的实时预览帧（瞬态：node_complete 时清除，不回放） */
  preview?: NodePreview
}

export interface Workflow {
  id: string
  name: string
  description?: string
  intent?: string
  yamlConfig: string
  status: 'idle' | 'running' | 'success' | 'failed' | 'paused'
  createdAt: Date
  updatedAt: Date
}
