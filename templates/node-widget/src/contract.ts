/**
 * FlowX Studio 节点 UI 组件数据契约（apiVersion 1）。
 * 与 flowx-studio/web/src/types/nodeWidget.ts 保持一致。
 */

export type NodeWidgetStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped'

/** 参数绑定来源（Studio 解析 workflow YAML 后随 props.paramSources 下发） */
export interface NodeWidgetParamSource {
  kind: 'workflow' | 'node' | 'literal'
  /** kind=workflow：流水线参数名 */
  paramName?: string
  /** kind=workflow：流水线参数当前值（随参数面板编辑实时更新） */
  paramValue?: string
  /** kind=node：被引用的上游节点实例 ID */
  nodeId?: string
  /** kind=node：被引用节点显示名（缺省回退 nodeId） */
  nodeName?: string
  /** kind=node：引用的输出字段名 */
  field?: string
  /** kind=node：上游节点运行时输出值（执行中/回放有数据时下发） */
  runtimeValue?: string
}

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
  /** 各参数绑定来源标注（可选，旧版 Studio 不下发；键与 params 对应） */
  paramSources?: Record<string, NodeWidgetParamSource>
  /** 全量替换该节点 config.params 并持久化；回放态为 undefined（只读），调用前判空 */
  onParamsChange?: (params: Record<string, string>) => void
  execution: NodeWidgetExecution | null
  /** 节点实时预览帧（可选）：节点经 stdout FLOWX_PREVIEW 标记上报帧地址，
      Studio 中转拉帧后随 SSE 进度事件下发 url；瞬态（node_complete 清除、
      回放态缺省），需判空；预览 UI 由组件自行渲染，<img src=url> 直出 */
  preview?: { url: string; progress?: number }
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
