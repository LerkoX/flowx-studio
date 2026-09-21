export interface WorkflowParam {
  key: string
  value: string | number | boolean | object
  description?: string
  originalValue: string | number | boolean | object
}

export interface NodePreview {
  /** 预览帧 HTTP 地址（Studio preview-frame 中转接口，媒体不经 base64） */
  url: string
  /** 可选进度 0~1 */
  progress?: number
  /** 节点上报的不透明任务标识（语义由节点生态自定；widget 可用于构造第三方服务动作路径） */
  jobId?: string
}

export interface NodeRuntimeData {
  nodeId: string
  inputs: string[]
  outputs: Record<string, string>
  status: string
  startTime?: string
  endTime?: string
  /** 节点运行中的实时预览帧地址（瞬态：node_complete 时清除，不回放） */
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
