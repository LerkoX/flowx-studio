import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useExecutionStore } from '@/stores/executionStore'
import { useWorkflowStore } from '@/stores/workflowStore'

interface ExecutionHistoryPanelProps {
  workflowId?: string
}

export default function ExecutionHistoryPanel({ workflowId }: ExecutionHistoryPanelProps) {
  const {
    executions,
    selectedExecutionId,
    executionNodes,
    loadingHistory,
    loadingNodes,
    loadExecutions,
    selectExecution,
    setLogFilter,
  } = useExecutionStore()
  const setNodeStatuses = useWorkflowStore((s) => s.setNodeStatuses)

  useEffect(() => {
    if (!workflowId) return
    loadExecutions(workflowId)
  }, [workflowId, loadExecutions])

  const handleSelectExecution = async (id: string) => {
    await selectExecution(id)
    const nodes = useExecutionStore.getState().executionNodes
    const statuses: Record<string, string> = {}
    nodes.forEach((n) => {
      statuses[n.nodeId] = n.status
    })
    setNodeStatuses(statuses)
  }

  const handleNodeClick = (nodeName: string) => {
    setLogFilter({ nodeFilter: nodeName })
  }

  if (!workflowId) {
    return (
      <div className="text-center py-8 text-white/30 text-xs">
        未选择工作流
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 执行历史列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loadingHistory && executions.length === 0 && (
          <div className="text-center py-8 text-white/30 text-xs">加载中...</div>
        )}
        {executions.length === 0 && !loadingHistory && (
          <div className="text-center py-8 text-white/30 text-xs">
            暂无执行记录
            <br />
            <span className="text-white/20">点击运行按钮开始执行</span>
          </div>
        )}
        {executions.map((execution) => (
          <motion.button
            key={execution.id}
            onClick={() => handleSelectExecution(execution.id)}
            className={`w-full text-left p-3 rounded-xl border transition-all ${
              selectedExecutionId === execution.id
                ? 'bg-white/10 border-indigo-500/30'
                : 'bg-white/5 border-white/10 hover:bg-white/[0.07]'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono text-white/60">#{execution.id}</span>
              <StatusBadge status={execution.status} />
            </div>
            <div className="text-xs text-white/40">
              {execution.startedAt ? formatDate(execution.startedAt) : '-'}
            </div>
            {execution.durationMs ? (
              <div className="text-[10px] text-white/30 mt-1">
                耗时 {formatDuration(execution.durationMs)}
              </div>
            ) : null}
          </motion.button>
        ))}
      </div>

      {/* 选中执行的节点状态 */}
      {selectedExecutionId && (
        <div className="border-t border-white/10 p-2">
          <div className="text-xs text-white/50 mb-2 px-1">节点状态</div>
          {loadingNodes ? (
            <div className="text-center py-4 text-white/30 text-xs">加载中...</div>
          ) : (
            <div className="space-y-1.5">
              {executionNodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => handleNodeClick(node.nodeName)}
                  className="w-full flex items-center justify-between p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <span className="text-xs text-white/80 truncate">{node.nodeName}</span>
                  <div className="flex items-center gap-2">
                    {node.durationMs ? (
                      <span className="text-[10px] text-white/30">
                        {formatDuration(node.durationMs)}
                      </span>
                    ) : null}
                    <StatusDot status={node.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    failed: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
    running: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
    pending: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    cancelled: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  }
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border ${
        colors[status] || colors.pending
      }`}
    >
      {status}
    </span>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'bg-emerald-400',
    failed: 'bg-rose-400',
    running: 'bg-cyan-400 animate-pulse',
    pending: 'bg-amber-400',
    skipped: 'bg-slate-400',
  }
  return (
    <span
      className={`w-2 h-2 rounded-full ${colors[status] || colors.pending}`}
    />
  )
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}
