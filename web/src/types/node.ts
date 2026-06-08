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
  sourceType?: 'git' | 'manual'
  sourceURL?: string
  sourcePath?: string
  
  createdAt?: Date
  updatedAt?: Date
}
