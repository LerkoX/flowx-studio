/**
 * 节点自定义 UI 组件（module 模式）数据契约 — apiVersion 1。
 *
 * 节点包在 flowx.json 的 ui.entry 中声明一个预编译的单文件 JS bundle，
 * bundle 需默认导出（ESM default export）或通过 FlowXNodeWidget.define() 注册
 * 一个 mount 函数。Studio 画布在节点卡片内嵌区域调用 mount 渲染组件，
 * 并在数据变化时调用返回句柄的 update()。
 *
 * 契约为只读：组件不能回调 Studio，不暴露认证信息。
 */

export type NodeWidgetStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped'

/** 流水线执行实例的实时 metadata（来自 SSE 推送，无运行实例时为 null） */
export interface NodeWidgetExecution {
  id: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  trigger?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  errorMessage?: string
  errorNodeId?: string
  metadata?: Record<string, unknown>
}

export interface NodeWidgetProps {
  /** pipeline 中的节点实例 ID */
  nodeId: string
  /** 节点包名 */
  nodeRef: string
  /** 节点执行状态 */
  status: NodeWidgetStatus
  /** 节点入参参数名列表 */
  inputs: string[]
  /** 节点运行时输出 */
  outputs: Record<string, string>
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
