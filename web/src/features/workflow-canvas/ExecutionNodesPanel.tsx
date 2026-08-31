import { useExecutionStore } from '@/stores/executionStore'

interface ExecutionNodesPanelProps {
  // 点击节点设置日志过滤后的回调（页面用它切换到日志 tab 给出即时反馈）
  onNodeFiltered?: () => void
}

// 回放态「节点」tab：展示所选执行的节点状态列表，
// 点击节点可按节点过滤日志（后端 node_id 过滤同时匹配 node_id 与 node_name）
export default function ExecutionNodesPanel({ onNodeFiltered }: ExecutionNodesPanelProps) {
  const executionNodes = useExecutionStore((s) => s.executionNodes)
  const loadingNodes = useExecutionStore((s) => s.loadingNodes)
  const nodeFilter = useExecutionStore((s) => s.logFilter.nodeFilter)
  const setLogFilter = useExecutionStore((s) => s.setLogFilter)

  const handleNodeClick = (nodeId: string) => {
    if (nodeFilter === nodeId) {
      // 再次点击已过滤的节点：清除过滤，停留在当前 tab
      setLogFilter({ nodeFilter: null })
      return
    }
    setLogFilter({ nodeFilter: nodeId })
    onNodeFiltered?.()
  }

  if (loadingNodes) {
    return <div className="text-center py-8 text-white/30 text-xs">加载中...</div>
  }

  if (executionNodes.length === 0) {
    return (
      <div className="text-center py-8 text-white/30 text-xs">
        暂无节点数据
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-white/30 px-1 pb-1">
        点击节点可过滤该节点的日志
      </div>
      {executionNodes.map((node) => {
        const filtered = nodeFilter === node.nodeId
        return (
          <button
            key={node.id}
            onClick={() => handleNodeClick(node.nodeId)}
            className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-all ${
              filtered
                ? 'bg-indigo-500/15 border-indigo-500/30'
                : 'bg-white/5 border-transparent hover:bg-white/10'
            }`}
            title={filtered ? '清除日志过滤' : '过滤该节点日志'}
          >
            <span className="text-xs text-white/80 truncate">{node.nodeName}</span>
            <div className="flex items-center gap-2 shrink-0">
              {node.durationMs ? (
                <span className="text-[10px] text-white/30">
                  {formatDuration(node.durationMs)}
                </span>
              ) : null}
              <StatusDot status={node.status} />
            </div>
          </button>
        )
      })}
    </div>
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}
