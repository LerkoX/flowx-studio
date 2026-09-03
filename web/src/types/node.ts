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

/** flowx.json 节点包配置（API 只读回传，对应后端 NodePackage） */
export interface NodePackageConfig {
  name: string
  displayName?: string
  description?: string
  version?: string
  author?: string
  tags?: string[]
  icon?: string
  language: string
  entry: string
  files?: string[]
  image?: string
  executor?: { ref?: string; type?: string; config?: Record<string, unknown> }
  requirements?: string[]
  parameters: NodeParameter[]
  env?: Record<string, string>
  run?: string
  outputs?: NodeOutput[]
  extract?: { type: string; patterns?: Record<string, string>; maxOutputSize?: number }
  mock?: NodeMockConfig
  ui?: NodeUIConfig
  timeout?: number
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
  
  // 节点包文件资产索引（内容存于 server 资产库，不再回传文件内容）
  fileAssets?: Record<string, { sha256: string; size: number; contentType?: string; kind: 'runtime' | 'ui' }>

  // 自定义 UI 组件配置（导入的节点包可能携带）
  ui?: NodeUIConfig

  // flowx.json 包配置（仅节点详情接口回传，只读）
  package?: NodePackageConfig

  createdAt?: Date
  updatedAt?: Date
}
