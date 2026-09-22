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

/** 工作流执行统计（列表接口附带，卡片展示运行中/成功/失败次数） */
export interface WorkflowStats {
  total: number
  /** 运行中口径：running | pending | paused */
  running: number
  success: number
  failed: number
  cancelled: number
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
  /** 仅列表接口返回；无执行记录时缺省 */
  stats?: WorkflowStats
}

/** 展开结果里的一条执行器实例（Executors 表条目） */
export interface ExecutorInstanceInfo {
  name: string
  /** local | docker | ... */
  type: string
  /** docker 远端地址（快照/注册实例的 config.host） */
  host?: string
  /** docker 镜像（config.image） */
  image?: string
  /** 是否存在于执行器注册表；false 表示展开器为节点合成的内部条目（名字不稳定，徽章显示类型） */
  registered?: boolean
}

/** 单个节点的执行器归属与解析来源（画布徽章） */
export interface NodeExecutorInfo {
  /** 执行器实例名；空表示快照未记录 */
  executor: string
  type: string
  /** 解析来源：workflow-explicit / package-preferred / snapshot ... */
  source?: string
  /** 需要提示的情况（降级/匿名实例等） */
  warning?: string
}

/** GET /workflows/:id/executors 响应 */
export interface ExecutorResolutionResult {
  /** workflow：按当前定义实时解析；snapshot：来自执行快照（回放态） */
  source: 'workflow' | 'snapshot'
  executors: Record<string, ExecutorInstanceInfo>
  nodes: Record<string, NodeExecutorInfo>
}

/** 节点输出完整性提示（执行器流被截断 / 未提取到输出数据） */
export type OutputIncompleteReason = 'stream-truncated' | 'extract-missing'
