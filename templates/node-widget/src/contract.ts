/**
 * FlowX Studio 节点 UI 组件数据契约（apiVersion 1）。
 * 与 flowx-studio/web/src/types/nodeWidget.ts 保持一致。
 */

export type NodeWidgetStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped'

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
  nodeId: string
  nodeRef: string
  status: NodeWidgetStatus
  inputs: string[]
  outputs: Record<string, string>
  /** 节点实例当前参数绑定（config.params）：常量或 {{ 上游.输出 }} 模板 */
  params: Record<string, string>
  /** 全量替换该节点 config.params 并持久化；回放态为 undefined（只读），调用前判空 */
  onParamsChange?: (params: Record<string, string>) => void
  execution: NodeWidgetExecution | null
  theme: 'dark'
  locale: string
}

export interface NodeWidgetHandle {
  update?: (props: NodeWidgetProps) => void
  unmount?: () => void
}

export type NodeWidgetMount = (
  el: HTMLElement,
  props: NodeWidgetProps
) => NodeWidgetHandle | void
