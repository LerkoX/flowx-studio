import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Pencil, X } from 'lucide-react'
import { useExecutionStore } from '@/stores/executionStore'
import { selectExecutionAndSync } from './executionSelection'

interface ExecutionContextBarProps {
  workflowId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 执行上下文条：常驻面板顶部，标识当前是「编辑态」还是某次执行的「回放态」，
// 点击展开历史执行下拉列表进行切换，选中执行后可一键返回编辑态
export default function ExecutionContextBar({
  workflowId,
  open,
  onOpenChange,
}: ExecutionContextBarProps) {
  const executions = useExecutionStore((s) => s.executions)
  const selectedExecutionId = useExecutionStore((s) => s.selectedExecutionId)
  const selectedExecution = useExecutionStore((s) => s.selectedExecution)
  const loadingHistory = useExecutionStore((s) => s.loadingHistory)
  const loadingSelected = useExecutionStore((s) => s.loadingSelected)
  const loadExecutions = useExecutionStore((s) => s.loadExecutions)

  useEffect(() => {
    if (workflowId) loadExecutions(workflowId)
  }, [workflowId, loadExecutions])

  // 展示数据优先取列表中的项（SSE 会实时刷新列表状态），详情接口数据兜底
  const current =
    executions.find((e) => e.id === selectedExecutionId) || selectedExecution

  const handleSelect = async (id: string) => {
    onOpenChange(false)
    if (id === selectedExecutionId) return
    await selectExecutionAndSync(id)
  }

  const handleExit = async () => {
    await selectExecutionAndSync(null)
  }

  return (
    <div className="relative border-b border-white/10">
      <div className="flex items-center gap-1 pr-2">
        {/* 主区域：点击展开/收起历史执行列表 */}
        <button
          onClick={() => onOpenChange(!open)}
          className="flex-1 flex items-center gap-2 min-w-0 px-3 py-2.5
                     rounded-lg hover:bg-white/5 transition-colors text-left"
          title="选择历史执行"
        >
          {selectedExecutionId ? (
            <>
              <StatusDot status={current?.status || 'pending'} />
              <span className="text-xs font-mono text-white/80 shrink-0">
                #{selectedExecutionId}
              </span>
              {current && <StatusBadge status={current.status} />}
              <span className="text-[11px] text-white/40 truncate">
                {current?.startedAt ? formatDate(current.startedAt) : ''}
              </span>
              {current?.status === 'running' ? (
                <span className="text-[11px] text-cyan-400 shrink-0">执行中</span>
              ) : current?.durationMs ? (
                <span className="text-[11px] text-white/30 shrink-0">
                  {formatDuration(current.durationMs)}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <Pencil size={13} className="text-white/40 shrink-0" />
              <span className="text-xs text-white/60 shrink-0">编辑态</span>
              <span className="text-[11px] text-white/30 truncate">
                选择历史执行可回放
              </span>
            </>
          )}
          <ChevronDown
            size={14}
            className={`ml-auto text-white/40 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {/* 退出回放态，返回编辑态 */}
        {selectedExecutionId && (
          <button
            onClick={handleExit}
            disabled={loadingSelected}
            className="p-1.5 rounded-md text-white/40 hover:text-white/80
                       hover:bg-white/10 transition-colors disabled:opacity-50"
            title="返回编辑态"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* 历史执行下拉列表 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-x-0 top-full z-30 max-h-72 overflow-y-auto
                       bg-[#141a33]/95 backdrop-blur-2xl border-b border-white/10
                       shadow-xl shadow-black/40 p-2 space-y-1.5"
          >
            {loadingHistory && executions.length === 0 && (
              <div className="text-center py-6 text-white/30 text-xs">加载中...</div>
            )}
            {!loadingHistory && executions.length === 0 && (
              <div className="text-center py-6 text-white/30 text-xs">
                暂无执行记录
                <br />
                <span className="text-white/20">点击运行按钮开始执行</span>
              </div>
            )}
            {executions.map((execution) => (
              <button
                key={execution.id}
                onClick={() => handleSelect(execution.id)}
                className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                  selectedExecutionId === execution.id
                    ? 'bg-white/10 border-indigo-500/30'
                    : 'bg-white/5 border-white/10 hover:bg-white/[0.08]'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-mono text-white/60">
                    #{execution.id}
                  </span>
                  <StatusBadge status={execution.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/40">
                    {execution.startedAt ? formatDate(execution.startedAt) : '-'}
                  </span>
                  {execution.durationMs ? (
                    <span className="text-[10px] text-white/30">
                      {formatDuration(execution.durationMs)}
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
      className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${colors[status] || colors.pending}`}
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
    cancelled: 'bg-slate-400',
  }
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${colors[status] || colors.pending}`}
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
