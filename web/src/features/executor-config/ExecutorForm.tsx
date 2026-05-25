import GlassPanel from '@/components/GlassPanel'

interface ExecutorFormProps {
  type: string
}

export default function ExecutorForm({ type }: ExecutorFormProps) {
  const configs: Record<string, { label: string; fields: { key: string; label: string; placeholder: string }[] }> = {
    local: {
      label: 'Local 执行器配置',
      fields: [
        { key: 'shell', label: 'Shell', placeholder: 'bash' },
        { key: 'workdir', label: '工作目录', placeholder: '/tmp' },
        { key: 'timeout', label: '超时时间', placeholder: '60' },
      ],
    },
    docker: {
      label: 'Docker 执行器配置',
      fields: [
        { key: 'registry', label: '镜像仓库', placeholder: 'docker.io' },
        { key: 'network', label: '网络模式', placeholder: 'bridge' },
        { key: 'workdir', label: '工作目录', placeholder: '/app' },
      ],
    },
    kubernetes: {
      label: 'Kubernetes 执行器配置',
      fields: [
        { key: 'namespace', label: '命名空间', placeholder: 'default' },
        { key: 'serviceAccount', label: 'ServiceAccount', placeholder: 'default' },
        { key: 'podReadyTimeout', label: 'Pod 就绪超时', placeholder: '60' },
      ],
    },
  }

  const config = configs[type] || configs.local

  return (
    <GlassPanel className="p-6">
      <h3 className="text-white/90 font-semibold text-sm mb-4">{config.label}</h3>
      <div className="space-y-4">
        {config.fields.map((field) => (
          <div key={field.key}>
            <label className="block text-white/60 text-xs mb-1.5">{field.label}</label>
            <input
              type="text"
              placeholder={field.placeholder}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                         text-white/90 text-sm placeholder:text-white/20
                         focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                         transition-all"
            />
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-3">
        <button className="px-4 py-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500
                           text-white text-sm font-medium hover:shadow-lg hover:shadow-indigo-500/30
                           transition-all">
          保存配置
        </button>
        <button className="px-4 py-2 rounded-xl bg-white/5 border border-white/10
                           text-white/60 text-sm hover:bg-white/10 hover:text-white
                           transition-all">
          测试连接
        </button>
      </div>
    </GlassPanel>
  )
}
