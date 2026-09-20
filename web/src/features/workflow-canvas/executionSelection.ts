import { useExecutionStore } from '@/stores/executionStore'
import { useWorkflowStore } from '@/stores/workflowStore'

// 选中/清除执行实例，并把节点状态同步到画布。
// 传入 id：进入回放态，画布回放着色为该执行的节点状态；
// 传入 null：退出回放态，画布恢复编辑态（清空状态着色与运行时数据）。
// 用 store 中当前的执行节点记录播种画布状态（选中历史执行 / 续跑刷新后调用）。
// 循环回边高亮依赖完成时间戳：用后端节点记录播种，避免无时间戳的兜底逻辑
// 把运行中节点的所有入边（含循环入环边）误点亮。后端在节点重跑（node_start）
// 时会清空 completed_at，故运行中节点此处无完成时间；其 prev 播种为本轮启动
// 时间——源节点完成必早于目标启动，中途选中运行中的执行时入边不会被误亮
// （后续 SSE 事件会用真实时间戳接管）
export function syncCanvasStatusesFromExecutionNodes(): void {
  const statuses: Record<string, string> = {}
  const completedAt: Record<string, number> = {}
  const prevCompletedAt: Record<string, number> = {}
  useExecutionStore.getState().executionNodes.forEach((n) => {
    statuses[n.nodeId] = n.status
    if (n.completedAt) completedAt[n.nodeId] = n.completedAt.getTime()
    if (n.status === 'running' && n.startedAt) {
      prevCompletedAt[n.nodeId] = n.startedAt.getTime()
    }
  })
  useWorkflowStore.getState().setNodeStatuses(statuses, { completedAt, prevCompletedAt })
}

export async function selectExecutionAndSync(id: string | null): Promise<void> {
  const workflow = useWorkflowStore.getState()
  // 切换/清除执行前先清空上一执行的节点运行时数据：metadata 播种与实时事件
  // 都是只增不减的合并，不重置会让上一执行的输出/预览残留到新视图
  // （如切到未产出图片的执行，上一个执行的 save-image 图片仍挂着）
  workflow.resetNodeRuntimeData()
  await useExecutionStore.getState().selectExecution(id)
  if (!id) {
    workflow.setNodeStatuses({})
    // 节点过滤属于某次执行的日志视图，退出回放态时一并清除
    useExecutionStore.getState().setLogFilter({ nodeFilter: null })
    return
  }
  syncCanvasStatusesFromExecutionNodes()
}
