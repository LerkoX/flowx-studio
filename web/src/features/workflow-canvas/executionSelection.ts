import { useExecutionStore } from '@/stores/executionStore'
import { useWorkflowStore } from '@/stores/workflowStore'

// 选中/清除执行实例，并把节点状态同步到画布。
// 传入 id：进入回放态，画布回放着色为该执行的节点状态；
// 传入 null：退出回放态，画布恢复编辑态（清空状态着色与运行时数据）。
export async function selectExecutionAndSync(id: string | null): Promise<void> {
  await useExecutionStore.getState().selectExecution(id)
  const workflow = useWorkflowStore.getState()
  if (!id) {
    workflow.setNodeStatuses({})
    workflow.resetNodeRuntimeData()
    // 节点过滤属于某次执行的日志视图，退出回放态时一并清除
    useExecutionStore.getState().setLogFilter({ nodeFilter: null })
    return
  }
  const statuses: Record<string, string> = {}
  // 循环回边高亮依赖完成时间戳：选中执行时用后端节点记录播种，
  // 避免无时间戳的兜底逻辑把运行中节点的所有入边（含循环入环边）误点亮。
  // 后端在节点重跑（node_start）时会清空 completed_at，故运行中节点此处
  // 无完成时间；其 prev 播种为本轮启动时间——源节点完成必早于目标启动，
  // 中途选中运行中的执行时入边不会被误亮（后续 SSE 事件会用真实时间戳接管）
  const completedAt: Record<string, number> = {}
  const prevCompletedAt: Record<string, number> = {}
  useExecutionStore.getState().executionNodes.forEach((n) => {
    statuses[n.nodeId] = n.status
    if (n.completedAt) completedAt[n.nodeId] = n.completedAt.getTime()
    if (n.status === 'running' && n.startedAt) {
      prevCompletedAt[n.nodeId] = n.startedAt.getTime()
    }
  })
  workflow.setNodeStatuses(statuses, { completedAt, prevCompletedAt })
}
