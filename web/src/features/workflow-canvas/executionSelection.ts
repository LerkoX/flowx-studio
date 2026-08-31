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
  useExecutionStore.getState().executionNodes.forEach((n) => {
    statuses[n.nodeId] = n.status
  })
  workflow.setNodeStatuses(statuses)
}
