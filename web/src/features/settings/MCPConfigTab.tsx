import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Terminal, Globe } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { MCPConfig } from '@/types/settings'
import GlassPanel from '@/components/GlassPanel'

interface MCPConfigFormProps {
  config?: MCPConfig
  onSave: (config: MCPConfig) => void
  onCancel: () => void
}

function MCPConfigForm({ config, onSave, onCancel }: MCPConfigFormProps) {
  const [formData, setFormData] = useState<Partial<MCPConfig>>({
    name: config?.name || '',
    mode: config?.mode || 'local',
    command: config?.command || '',
    args: config?.args || [],
    env: config?.env || {},
    url: config?.url || '',
    authHeaderKey: config?.authHeaderKey || '',
    authHeaderValue: config?.authHeaderValue || '',
    isEnabled: config?.isEnabled ?? true,
  })

  const [argsInput, setArgsInput] = useState(config?.args?.join(' ') || '')
  const [envInput, setEnvInput] = useState(
    config?.env ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`).join('\n') : ''
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name) return

    // Parse args
    const args = argsInput.trim() ? argsInput.split(/\s+/) : []
    
    // Parse env
    const env: Record<string, string> = {}
    envInput.split('\n').forEach((line) => {
      const [key, ...valueParts] = line.split('=')
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim()
      }
    })

    onSave({
      id: config?.id || `mcp-${Date.now()}`,
      name: formData.name,
      mode: formData.mode as MCPConfig['mode'],
      command: formData.mode === 'local' ? formData.command : undefined,
      args: formData.mode === 'local' ? args : undefined,
      env: formData.mode === 'local' ? env : undefined,
      url: formData.mode === 'remote' ? formData.url : undefined,
      authHeaderKey: formData.mode === 'remote' ? formData.authHeaderKey : undefined,
      authHeaderValue: formData.mode === 'remote' ? formData.authHeaderValue : undefined,
      isEnabled: formData.isEnabled ?? true,
      status: 'disconnected',
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-white/60 text-xs mb-1.5">名称</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="例如：Claude Code MCP"
          className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                   text-white/90 text-sm placeholder:text-white/20
                   focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                   transition-all"
        />
      </div>

      {/* 模式切换 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setFormData({ ...formData, mode: 'local' })}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm
            transition-all border
            ${formData.mode === 'local'
              ? 'bg-white/10 border-white/20 text-white'
              : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'
            }`}
        >
          <Terminal size={14} />
          本地命令
        </button>
        <button
          type="button"
          onClick={() => setFormData({ ...formData, mode: 'remote' })}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm
            transition-all border
            ${formData.mode === 'remote'
              ? 'bg-white/10 border-white/20 text-white'
              : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'
            }`}
        >
          <Globe size={14} />
          远程 SSE
        </button>
      </div>

      {formData.mode === 'local' ? (
        <>
          <div>
            <label className="block text-white/60 text-xs mb-1.5">命令</label>
            <input
              type="text"
              value={formData.command}
              onChange={(e) => setFormData({ ...formData, command: e.target.value })}
              placeholder="例如：claude"
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                       text-white/90 text-sm placeholder:text-white/20
                       focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                       transition-all"
            />
          </div>
          <div>
            <label className="block text-white/60 text-xs mb-1.5">参数（空格分隔）</label>
            <input
              type="text"
              value={argsInput}
              onChange={(e) => setArgsInput(e.target.value)}
              placeholder="例如：mcp serve --port 8080"
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                       text-white/90 text-sm placeholder:text-white/20
                       focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                       transition-all"
            />
          </div>
          <div>
            <label className="block text-white/60 text-xs mb-1.5">环境变量（每行一个 KEY=VALUE）</label>
            <textarea
              value={envInput}
              onChange={(e) => setEnvInput(e.target.value)}
              placeholder="API_KEY=xxx&#10;DEBUG=true"
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                       text-white/90 text-sm placeholder:text-white/20
                       focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                       transition-all resize-none font-mono"
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-white/60 text-xs mb-1.5">SSE URL</label>
            <input
              type="text"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder="http://localhost:8081/sse"
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                       text-white/90 text-sm placeholder:text-white/20
                       focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                       transition-all"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-white/60 text-xs mb-1.5">Auth Header Key</label>
              <input
                type="text"
                value={formData.authHeaderKey}
                onChange={(e) => setFormData({ ...formData, authHeaderKey: e.target.value })}
                placeholder="X-API-Key"
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                         text-white/90 text-sm placeholder:text-white/20
                         focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                         transition-all"
              />
            </div>
            <div>
              <label className="block text-white/60 text-xs mb-1.5">Auth Header Value</label>
              <input
                type="password"
                value={formData.authHeaderValue}
                onChange={(e) => setFormData({ ...formData, authHeaderValue: e.target.value })}
                placeholder="your-api-key"
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                         text-white/90 text-sm placeholder:text-white/20
                         focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                         transition-all"
              />
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 pt-2">
        <label className="flex items-center gap-2 text-white/60 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={formData.isEnabled}
            onChange={(e) => setFormData({ ...formData, isEnabled: e.target.checked })}
            className="rounded bg-white/5 border-white/10"
          />
          启用
        </label>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 text-white/60
                   text-sm hover:bg-white/10 hover:text-white transition-all"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={!formData.name}
          className="flex-1 px-4 py-2.5 rounded-xl 
                   bg-gradient-to-br from-indigo-500 to-purple-500
                   text-white text-sm font-medium
                   hover:shadow-lg hover:shadow-indigo-500/30
                   transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          保存
        </button>
      </div>
    </form>
  )
}

export default function MCPConfigTab() {
  const { mcpConfigs, addMCPConfig, updateMCPConfig, deleteMCPConfig, toggleMCPConfig } = useSettingsStore()
  const [editingConfig, setEditingConfig] = useState<MCPConfig | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const handleSave = (config: MCPConfig) => {
    if (editingConfig) {
      updateMCPConfig(editingConfig.id, config)
    } else {
      addMCPConfig(config)
    }
    setEditingConfig(null)
    setIsAdding(false)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'text-emerald-400'
      case 'error':
        return 'text-rose-400'
      default:
        return 'text-white/30'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'connected':
        return '已连接'
      case 'error':
        return '错误'
      default:
        return '未连接'
    }
  }

  return (
    <div className="space-y-6">
      {/* 添加按钮 */}
      {!isAdding && !editingConfig && (
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                   bg-white/5 border border-white/10 text-white/60
                   text-sm hover:bg-white/10 hover:text-white
                   transition-all"
        >
          <Plus size={16} />
          添加 MCP 服务器
        </button>
      )}

      {/* 表单 */}
      <AnimatePresence>
        {(isAdding || editingConfig) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <GlassPanel className="p-6">
              <h3 className="text-white/90 font-semibold text-sm mb-4">
                {editingConfig ? '编辑 MCP 配置' : '添加 MCP 服务器'}
              </h3>
              <MCPConfigForm
                config={editingConfig || undefined}
                onSave={handleSave}
                onCancel={() => {
                  setIsAdding(false)
                  setEditingConfig(null)
                }}
              />
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 列表 */}
      <div className="space-y-3">
        {mcpConfigs.map((config) => (
          <GlassPanel key={config.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-white/90 font-medium text-sm">{config.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border
                    ${config.isEnabled 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                      : 'bg-white/5 text-white/30 border-white/10'
                    }`}
                  >
                    {config.isEnabled ? '已启用' : '已禁用'}
                  </span>
                  <span className={`text-[10px] ${getStatusColor(config.status)}`}>
                    {getStatusText(config.status)}
                  </span>
                </div>
                <div className="text-white/40 text-xs space-y-1">
                  <p className="flex items-center gap-1">
                    {config.mode === 'local' ? (
                      <>
                        <Terminal size={10} />
                        <span className="font-mono">{config.command} {config.args?.join(' ')}</span>
                      </>
                    ) : (
                      <>
                        <Globe size={10} />
                        <span className="font-mono">{config.url}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleMCPConfig(config.id)}
                  className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10
                           transition-all"
                  title={config.isEnabled ? '禁用' : '启用'}
                >
                  {config.isEnabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                </button>
                <button
                  onClick={() => setEditingConfig(config)}
                  className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10
                           transition-all"
                  title="编辑"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => {
                    if (confirm('确定要删除这个 MCP 配置吗？')) {
                      deleteMCPConfig(config.id)
                    }
                  }}
                  className="p-2 rounded-lg text-white/40 hover:text-rose-400 hover:bg-rose-500/10
                           transition-all"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </GlassPanel>
        ))}
      </div>
    </div>
  )
}
