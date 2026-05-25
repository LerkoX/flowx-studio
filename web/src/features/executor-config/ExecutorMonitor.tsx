import GlassPanel from '@/components/GlassPanel'

interface ExecutorMonitorProps {
  type: string
}

export default function ExecutorMonitor({ type }: ExecutorMonitorProps) {
  return (
    <GlassPanel className="p-6">
      <h3 className="text-white/90 font-semibold text-sm mb-4">状态监控</h3>

      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="CPU 使用率" value="12%" trend="up" />
        <MetricCard label="内存使用" value="256MB" trend="stable" />
        <MetricCard label="活跃任务" value="3" trend="down" />
      </div>

      <div className="mt-6">
        <h4 className="text-white/60 text-xs mb-3">最近活动</h4>
        <div className="space-y-2">
          {[
            { time: '10:23:45', event: '执行器初始化完成', type: 'local' },
            { time: '10:23:40', event: '连接测试通过', type: 'docker' },
            { time: '10:23:35', event: '配置已更新', type: type },
          ].map((log, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="text-white/30 font-mono">{log.time}</span>
              <span className="text-white/50">{log.event}</span>
              <span className="text-white/20">({log.type})</span>
            </div>
          ))}
        </div>
      </div>
    </GlassPanel>
  )
}

function MetricCard({ label, value, trend }: { label: string; value: string; trend: 'up' | 'down' | 'stable' }) {
  const trendColors = {
    up: 'text-emerald-400',
    down: 'text-rose-400',
    stable: 'text-white/40',
  }

  const trendIcons = {
    up: '↑',
    down: '↓',
    stable: '→',
  }

  return (
    <div className="p-3 rounded-xl bg-white/5 border border-white/5">
      <div className="text-white/40 text-xs mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className="text-white/90 text-lg font-semibold">{value}</span>
        <span className={`text-xs ${trendColors[trend]}`}>{trendIcons[trend]}</span>
      </div>
    </div>
  )
}
