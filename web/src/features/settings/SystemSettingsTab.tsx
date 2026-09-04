import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Moon, Sun, Globe, Bell, Shield, Save, RotateCcw, AlertCircle } from 'lucide-react'
import { useSettingsStore, defaultSystemSettings } from '@/stores/settingsStore'
import { toast } from '@/stores/toastStore'
import GlassPanel from '@/components/GlassPanel'
import Select from '@/components/Select'

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      // !min-h-0/!min-w-0：覆盖全局移动端触摸优化（button min-height:36px），
      // 保持开关的 44x24 设计尺寸
      className={`w-11 h-6 !min-h-0 !min-w-0 rounded-full transition-all relative flex-shrink-0
        ${value ? 'bg-indigo-500' : 'bg-white/10'}`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-on-accent shadow transition-all
          ${value ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Monitor; children: React.ReactNode }) {
  return (
    <h3 className="text-white/90 font-semibold text-sm mb-4 flex items-center gap-2">
      <Icon size={16} className="text-indigo-400" />
      {children}
    </h3>
  )
}

export default function SystemSettingsTab() {
  const { t } = useTranslation()
  const systemSettings = useSettingsStore((s) => s.systemSettings)
  const updateSystemSettings = useSettingsStore((s) => s.updateSystemSettings)
  const loadSystemSettings = useSettingsStore((s) => s.loadSystemSettings)
  const error = useSettingsStore((s) => s.error)
  const [formData, setFormData] = useState(systemSettings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // 挂载时拉取最新配置；store 变化（含首次加载完成）时同步到表单
  useEffect(() => {
    loadSystemSettings()
  }, [loadSystemSettings])

  useEffect(() => {
    setFormData(systemSettings)
  }, [systemSettings])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSystemSettings(formData)
      setSaved(true)
      toast.success(t('settings.savedToast'))
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      toast.error(t('settings.saveFailed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (confirm(t('settings.resetConfirm'))) {
      setFormData(defaultSystemSettings)
    }
  }

  // 主题/语言为即时生效项：选择即保存并应用，无需点「保存设置」；
  // 失败时回滚到 store 中的当前值
  const applyImmediate = async (patch: Partial<typeof formData>) => {
    const prev = systemSettings
    setFormData({ ...formData, ...patch })
    try {
      await updateSystemSettings(patch)
    } catch (e) {
      toast.error(t('settings.saveFailed', { message: e instanceof Error ? e.message : String(e) }))
      setFormData(prev)
    }
  }

  return (
    <div className="space-y-6">
      <GlassPanel className="p-6">
        {error && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-xl
                          bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
        <div className="space-y-6">
          {/* 外观 */}
          <div>
            <SectionTitle icon={Monitor}>{t('settings.appearance')}</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'dark', label: t('settings.themeDark'), icon: Moon },
                { value: 'light', label: t('settings.themeLight'), icon: Sun },
                { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => applyImmediate({ theme: value as typeof formData.theme })}
                  className={`flex flex-col items-center gap-2 py-4 rounded-xl border transition-all
                    ${formData.theme === value
                      ? 'bg-white/10 border-indigo-500/30 text-white'
                      : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'
                    }`}
                >
                  <Icon size={20} />
                  <span className="text-xs">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* 语言 */}
          <div>
            <SectionTitle icon={Globe}>{t('settings.language')}</SectionTitle>
            <Select
              value={formData.language}
              onChange={(v) => applyImmediate({ language: v })}
              options={[
                { value: 'zh-CN', label: '简体中文' },
                { value: 'en-US', label: 'English' },
              ]}
              triggerClassName="px-3 py-2 rounded-xl text-sm text-white/90"
            />
          </div>

          <div className="h-px bg-white/5" />

          {/* 编辑器 */}
          <div>
            <SectionTitle icon={Save}>{t('settings.editor')}</SectionTitle>
            <div className="space-y-4">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-white/60 text-sm">{t('settings.autoSave')}</span>
                <Toggle
                  value={formData.autoSave}
                  onChange={(v) => setFormData({ ...formData, autoSave: v })}
                />
              </label>

              {formData.autoSave && (
                <div>
                  <label className="block text-white/60 text-xs mb-1.5">
                    {t('settings.autoSaveInterval')}
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    value={formData.autoSaveInterval}
                    onChange={(e) => setFormData({ ...formData, autoSaveInterval: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                             text-white/90 text-sm focus:outline-none focus:border-white/20
                             transition-all"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* 通知 */}
          <div>
            <SectionTitle icon={Bell}>{t('settings.notifications')}</SectionTitle>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-white/60 text-sm">{t('settings.showNotifications')}</span>
              <Toggle
                value={formData.showNotifications}
                onChange={(v) => setFormData({ ...formData, showNotifications: v })}
              />
            </label>
          </div>

          <div className="h-px bg-white/5" />

          {/* 安全 */}
          <div>
            <SectionTitle icon={Shield}>{t('settings.security')}</SectionTitle>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-white/60 text-sm">{t('settings.confirmBeforeDelete')}</span>
              <Toggle
                value={formData.confirmBeforeDelete}
                onChange={(v) => setFormData({ ...formData, confirmBeforeDelete: v })}
              />
            </label>
          </div>

          <div className="h-px bg-white/5" />

          {/* 执行器 */}
          <div>
            <SectionTitle icon={RotateCcw}>{t('settings.executorSection')}</SectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-white/60 text-xs mb-1.5">
                  {t('settings.defaultNodeTimeout')}
                </label>
                <input
                  type="number"
                  min="10"
                  max="3600"
                  value={formData.defaultNodeTimeout}
                  onChange={(e) =>
                    setFormData({ ...formData, defaultNodeTimeout: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                           text-white/90 text-sm focus:outline-none focus:border-white/20
                           transition-all"
                />
              </div>
              <div>
                <label className="block text-white/60 text-xs mb-1.5">
                  {t('settings.maxConcurrentExecutions')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={formData.maxConcurrentExecutions}
                  onChange={(e) =>
                    setFormData({ ...formData, maxConcurrentExecutions: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                           text-white/90 text-sm focus:outline-none focus:border-white/20
                           transition-all"
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* 日志 */}
          <div>
            <SectionTitle icon={RotateCcw}>{t('settings.logSection')}</SectionTitle>
            <div>
              <label className="block text-white/60 text-xs mb-1.5">
                {t('settings.logRetentionDays')}
              </label>
              <input
                type="number"
                min="1"
                max="90"
                value={formData.logRetentionDays}
                onChange={(e) =>
                  setFormData({ ...formData, logRetentionDays: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                         text-white/90 text-sm focus:outline-none focus:border-white/20
                         transition-all"
              />
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3 pt-6 mt-6 border-t border-white/5">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2.5 rounded-xl bg-white/5 text-white/60
                     text-sm hover:bg-white/10 hover:text-white transition-all"
          >
            {t('settings.resetDefaults')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-all
              ${saved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-gradient-to-br from-indigo-500 to-purple-500 text-on-accent hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-50'
              }`}
          >
            {saved ? t('common.saved') : t('settings.saveSettings')}
          </button>
        </div>
      </GlassPanel>
    </div>
  )
}
