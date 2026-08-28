export interface NodeParameter {
  name: string
  type: string
  description: string
  required: boolean
  default?: unknown
}

export interface NodeOutput {
  name: string
  type: string
  description: string
}

export interface NodeDockerConfig {
  image?: string
  workdir?: string
}

export interface NodeMockConfig {
  enabled: boolean
  entry?: string
}

/** 节点自定义 UI 组件配置（module 模式，见 flowx.json 的 ui 字段） */
export interface NodeUIConfig {
  entry: string
  width?: number
  height?: number
  collapsed?: boolean
  apiVersion?: number
}

export interface NodeDefinition {
  id: string
  name: string
  displayName?: string
  description?: string
  version?: string
  author?: string
  tags?: string[]
  icon?: string
  
  // 节点类型：code 代码节点 | image 镜像节点
  nodeType: 'code' | 'image'
  
  // 代码节点字段
  language?: string
  entry?: string
  parameters: NodeParameter[]
  outputs?: NodeOutput[]
  requirements?: string[]
  docker?: NodeDockerConfig
  mock?: NodeMockConfig
  
  // 镜像节点字段
  image?: string
  
  // 来源信息
  sourceType?: 'git' | 'image' | 'folder' | 'manual'
  sourceURL?: string
  sourcePath?: string
  
  // 节点包文件
  files?: Record<string, string>

  // 自定义 UI 组件配置（导入的节点包可能携带）
  ui?: NodeUIConfig

  createdAt?: Date
  updatedAt?: Date
}
