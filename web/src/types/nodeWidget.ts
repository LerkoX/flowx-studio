/**
 * 节点自定义 UI 组件（module 模式）数据契约 — apiVersion 1。
 *
 * 节点包在 flowx.json 的 ui.entry 中声明一个预编译的单文件 JS bundle，
 * bundle 需默认导出（ESM default export）或通过 FlowXNodeWidget.define() 注册
 * 一个 mount 函数。Studio 画布在节点卡片内嵌区域调用 mount 渲染组件，
 * 并在数据变化时调用返回句柄的 update()。
 *
 * 交互能力：组件可通过 props.onParamsChange 把参数调整写回当前节点实例的
 * config.params（workflow YAML）。回放态（查看历史执行快照）下回调缺省，
 * 组件进入只读展示。除该回调外不暴露 Studio 其他能力与认证信息。
 */

export type NodeWidgetStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped'

/**
 * 参数绑定来源信息。Studio 解析 workflow YAML 后为每个 config.params 键计算，
 * 随 props.paramSources 下发，组件可用于渲染「该值从哪来」的标注：
 * - workflow：{{ Param.xxx }} 引用流水线参数，附 paramName 与当前值 paramValue
 * - node：{{ 节点ID.字段 }} 引用上游节点输出，附节点显示名与运行时值（如有）
 * - literal：用户直接填写的字面值
 */
export interface NodeWidgetParamSource {
  kind: 'workflow' | 'node' | 'literal'
  /** kind=workflow：流水线参数名（YAML Param 区键名） */
  paramName?: string
  /** kind=workflow：流水线参数当前值（随参数面板编辑实时更新；参数未定义时缺省） */
  paramValue?: string
  /** kind=node：被引用的上游节点实例 ID */
  nodeId?: string
  /** kind=node：被引用节点的显示名（YAML Nodes.<id>.name，未设置时缺省，组件回退 nodeId） */
  nodeName?: string
  /** kind=node：引用的输出字段名 */
  field?: string
  /** kind=node：上游节点运行时输出值（执行中/回放有数据时下发，否则缺省） */
  runtimeValue?: string
}

/** 流水线执行实例的实时 metadata（来自 SSE 推送，无运行实例时为 null） */
export interface NodeWidgetExecution {
  id: string
  status: 'pending' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled'
  trigger?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  errorMessage?: string
  errorNodeId?: string
  metadata?: Record<string, unknown>
}

export interface NodeWidgetProps {
  /** workflow 中的节点实例 ID */
  nodeId: string
  /** 节点包名 */
  nodeRef: string
  /** 节点执行状态 */
  status: NodeWidgetStatus
  /** 节点入参参数名列表 */
  inputs: string[]
  /** 节点运行时输出 */
  outputs: Record<string, string>
  /**
   * 节点实例当前的参数绑定（workflow YAML 中该节点的 config.params）。
   * 值为常量字符串或上游引用模板（如 "{{ GetWeather.city }}"），原样下发。
   */
  params: Record<string, string>
  /**
   * 各参数绑定的来源信息（键与 params 对应），Studio 解析 YAML 后下发。
   * 可选字段：旧版 Studio 不下发，组件需判空并回退到 params 原值展示。
   */
  paramSources?: Record<string, NodeWidgetParamSource>
  /**
   * 参数写回回调：传入完整的参数表（全量替换该节点的 config.params，
   * 传 {} 清空绑定），Studio 写回 workflow YAML 并持久化。
   * 回放态（执行快照）或画布预览（非编辑）模式下为 undefined，
   * 组件调用前需判空进入只读模式。
   */
  onParamsChange?: (params: Record<string, string>) => void
  /** 流水线执行实例实时 metadata；无运行实例时为 null */
  execution: NodeWidgetExecution | null
  /** 当前主题 */
  theme: 'dark' | 'light'
  /** 语言环境，预留 */
  locale: string
}

/** mount 返回的控制句柄，update/unmount 均为可选 */
export interface NodeWidgetHandle {
  update?: (props: NodeWidgetProps) => void
  unmount?: () => void
}

/** 组件包默认导出的挂载函数签名 */
export type NodeWidgetMount = (
  el: HTMLElement,
  props: NodeWidgetProps
) => NodeWidgetHandle | void
