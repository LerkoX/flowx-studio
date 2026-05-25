import GlassPanel from '@/components/GlassPanel'

export default function ExecutorList() {
  return (
    <GlassPanel className="p-4">
      <h3 className="text-white/90 font-semibold text-sm mb-3">已注册执行器</h3>
      <div className="space-y-2">
        {['local', 'docker', 'kubernetes'].map((name) => (
          <div
            key={name}
            className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
              <span className="text-white/80 text-sm">{name}</span>
            </div>
            <span className="text-white/30 text-xs">就绪</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  )
}
