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
  executor?: {
    supportedTypes?: Array<'local' | 'docker'>
    preferredType?: 'local' | 'docker'
    /** 旧版兼容字段：新节点包不应绑定用户环境中的实例名 */
    ref?: string
    /** 旧版兼容字段：新节点包使用 supportedTypes/preferredType */
    type?: string
    config?: Record<string, unknown>
  }
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

  // 节点包声明的执行器能力（API 只读透出，列表接口也有）
  executor?: NodeExecutorDecl

  // 执行器声明一致性检查（API 只读，节点管理列表据此提示）
  executorCheck?: NodeExecutorCheck

  // flowx.json 包配置（仅节点详情接口回传，只读）
  package?: NodePackageConfig

  createdAt?: Date
  updatedAt?: Date
}

/** 节点包声明的执行器能力（由 flowx.json 的 executor 字段派生） */
export interface NodeExecutorDecl {
  supportedTypes?: string[]
  preferredType?: string
  /** 代码是否已打进镜像（docker 执行时不再从 Studio 拉取资产） */
  bundled?: boolean
  /** 旧版兼容字段：绑定具体执行器实例名 */
  ref?: string
  /** 旧版兼容字段：固定执行器类型 */
  type?: string
  config?: Record<string, unknown>
}

/** 执行器声明自洽性检查（后端 model.NodeExecutorCheck） */
export interface NodeExecutorCheck {
  /** 声明允许的执行器类型 */
  types: string[]
  preferred?: string
  image?: string
  bundled: boolean
  /** docker 声明是否齐备（image + bundled） */
  dockerOk: boolean
  /** 不一致项（人类可读，后端生成） */
  issues?: string[]
}
