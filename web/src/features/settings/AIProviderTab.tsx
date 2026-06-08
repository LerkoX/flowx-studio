import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Pencil, Trash2, TestTube, Check, Loader2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { AIProviderConfig } from '@/types/settings'
import GlassPanel from '@/components/GlassPanel'

interface AIProviderFormProps {
  provider?: AIProviderConfig
  onSave: (provider: AIProviderConfig) => void
  onCancel: () => void
}

function AIProviderForm({ provider, onSave, onCancel }: AIProviderFormProps) {
  const [formData, setFormData] = useState<Partial<AIProviderConfig>>({
    name: provider?.name || '',
    providerType: provider?.providerType || 'openai',
    apiKey: provider?.apiKey || '',
    baseURL: provider?.baseURL || '',
    model: provider?.model || '',
    temperature: provider?.temperature ?? 0.7,
    maxTokens: provider?.maxTokens || 4096,
    isEnabled: provider?.isEnabled ?? true,
  })

  const providerTypes = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'ollama', label: 'Ollama' },
    { value: 'custom', label: '自定义' },
  ]

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.model) return

    onSave({
      id: provider?.id || `ai-${Date.now()}`,
      name: formData.name,
      providerType: formData.providerType as AIProviderConfig['providerType'],
      apiKey: formData.apiKey,
      baseURL: formData.baseURL,
      model: formData.model,
      temperature: formData.temperature || 0.7,
      maxTokens: formData.maxTokens,
      isActive: provider?.isActive || false,
      isEnabled: formData.isEnabled ?? true,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-white/60 text-xs mb-1.5">名称</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="例如：OpenAI GPT-4"
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                     text-white/90 text-sm placeholder:text-white/20
                     focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                     transition-all"
          />
        </div>

        <div>
          <label className="block text-white/60 text-xs mb-1.5">提供商类型</label>
          <select
            value={formData.providerType}
            onChange={(e) => setFormData({ ...formData, providerType: e.target.value as AIProviderConfig['providerType'] })}
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                     text-white/90 text-sm focus:outline-none focus:border-white/20
                     cursor-pointer"
          >
            {providerTypes.map((type) => (
              <option key={type.value} value={type.value} className="bg-[#1a1f3a]">
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-white/60 text-xs mb-1.5">模型</label>
          <input
            type="text"
            value={formData.model}
            onChange={(e) => setFormData({ ...formData, model: e.target.value })}
            placeholder="例如：gpt-4"
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                     text-white/90 text-sm placeholder:text-white/20
                     focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                     transition-all"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-white/60 text-xs mb-1.5">API Key</label>
          <input
            type="password"
            value={formData.apiKey}
            onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
            placeholder="sk-xxxxxxxx"
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                     text-white/90 text-sm placeholder:text-white/20
                     focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                     transition-all"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-white/60 text-xs mb-1.5">Base URL（可选）</label>
          <input
            type="text"
            value={formData.baseURL}
            onChange={(e) => setFormData({ ...formData, baseURL: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                     text-white/90 text-sm placeholder:text-white/20
                     focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                     transition-all"
          />
        </div>

        <div>
          <label className="block text-white/60 text-xs mb-1.5">温度 ({formData.temperature})</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={formData.temperature}
            onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-white/60 text-xs mb-1.5">Max Tokens</label>
          <input
            type="number"
            value={formData.maxTokens}
            onChange={(e) => setFormData({ ...formData, maxTokens: parseInt(e.target.value) })}
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                     text-white/90 text-sm focus:outline-none focus:border-white/20
                     transition-all"
          />
        </div>
      </div>

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
          disabled={!formData.name || !formData.model}
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

export default function AIProviderTab() {
  const { aiProviders, addAIProvider, updateAIProvider, deleteAIProvider, setActiveAIProvider } = useSettingsStore()
  const [editingProvider, setEditingProvider] = useState<AIProviderConfig | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const handleSave = (provider: AIProviderConfig) => {
    if (editingProvider) {
      updateAIProvider(editingProvider.id, provider)
    } else {
      addAIProvider(provider)
    }
    setEditingProvider(null)
    setIsAdding(false)
  }

  const handleTest = async (id: string) => {
    setTestingId(id)
    // TODO: 调用后端测试 API
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setTestingId(null)
  }

  const getProviderTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      ollama: 'Ollama',
      custom: '自定义',
    }
    return labels[type] || type
  }

  return (
    <div className="space-y-6">
      {/* 添加按钮 */}
      {!isAdding && !editingProvider && (
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                   bg-white/5 border border-white/10 text-white/60
                   text-sm hover:bg-white/10 hover:text-white
                   transition-all"
        >
          <Plus size={16} />
          添加提供商
        </button>
      )}

      {/* 表单 */}
      <AnimatePresence>
        {(isAdding || editingProvider) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <GlassPanel className="p-6">
              <h3 className="text-white/90 font-semibold text-sm mb-4">
                {editingProvider ? '编辑提供商' : '添加提供商'}
              </h3>
              <AIProviderForm
                provider={editingProvider || undefined}
                onSave={handleSave}
                onCancel={() => {
                  setIsAdding(false)
                  setEditingProvider(null)
                }}
              />
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 列表 */}
      <div className="space-y-3">
        {aiProviders.map((provider) => (
          <GlassPanel
            key={provider.id}
            className={`p-4 ${provider.isActive ? 'border-indigo-500/30 bg-indigo-500/5' : ''}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white/90 font-medium text-sm">{provider.name}</span>
                  {provider.isActive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full 
                                   bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      默认
                    </span>
                  )}
                  {!provider.isEnabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full 
                                   bg-white/5 text-white/30 border border-white/10">
                      已禁用
                    </span>
                  )}
                </div>
                <div className="text-white/40 text-xs space-y-1">
                  <p>{getProviderTypeLabel(provider.providerType)} · {provider.model}</p>
                  {provider.baseURL && <p className="font-mono">{provider.baseURL}</p>}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {!provider.isActive && provider.isEnabled && (
                  <button
                    onClick={() => setActiveAIProvider(provider.id)}
                    className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10
                             transition-all"
                    title="设为默认"
                  >
                    <Check size={14} />
                  </button>
                )}
                <button
                  onClick={() => handleTest(provider.id)}
                  disabled={testingId === provider.id}
                  className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10
                           transition-all disabled:opacity-50"
                  title="测试连接"
                >
                  {testingId === provider.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <TestTube size={14} />
                  )}
                </button>
                <button
                  onClick={() => setEditingProvider(provider)}
                  className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10
                           transition-all"
                  title="编辑"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => {
                    if (confirm('确定要删除这个提供商吗？')) {
                      deleteAIProvider(provider.id)
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
