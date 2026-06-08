import { useState } from 'react'
import { Monitor, Moon, Sun, Globe, Bell, Shield, Save, RotateCcw } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import GlassPanel from '@/components/GlassPanel'

export default function SystemSettingsTab() {
  const { systemSettings, updateSystemSettings } = useSettingsStore()
  const [formData, setFormData] = useState(systemSettings)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    updateSystemSettings(formData)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    if (confirm('确定要重置为默认设置吗？')) {
      setFormData({
        theme: 'dark',
        language: 'zh-CN',
        autoSave: true,
        autoSaveInterval: 30,
        showNotifications: true,
        confirmBeforeDelete: true,
        defaultNodeTimeout: 300,
        maxConcurrentExecutions: 5,
        logRetentionDays: 7,
      })
    }
  }

  return (
    <div className="space-y-6">
      <GlassPanel className="p-6">
        <div className="space-y-6">
          {/* 外观 */}
          <div>
            <h3 className="text-white/90 font-semibold text-sm mb-4 flex items-center gap-2">
              <Monitor size={16} className="text-indigo-400" />
              外观
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'dark', label: '深色', icon: Moon },
                { value: 'light', label: '浅色', icon: Sun },
                { value: 'system', label: '跟随系统', icon: Monitor },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFormData({ ...formData, theme: value as typeof formData.theme })}
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
            <h3 className="text-white/90 font-semibold text-sm mb-4 flex items-center gap-2">
              <Globe size={16} className="text-indigo-400" />
              语言
            </h3>
            <select
              value={formData.language}
              onChange={(e) => setFormData({ ...formData, language: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                       text-white/90 text-sm focus:outline-none focus:border-white/20
                       cursor-pointer"
            >
              <option value="zh-CN" className="bg-[#1a1f3a]">简体中文</option>
              <option value="en-US" className="bg-[#1a1f3a]">English</option>
            </select>
          </div>

          <div className="h-px bg-white/5" />

          {/* 编辑器 */}
          <div>
            <h3 className="text-white/90 font-semibold text-sm mb-4 flex items-center gap-2">
              <Save size={16} className="text-indigo-400" />
              编辑器
            </h3>
            <div className="space-y-4">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-white/60 text-sm">自动保存</span>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, autoSave: !formData.autoSave })}
                  className={`w-11 h-6 rounded-full transition-all relative
                    ${formData.autoSave ? 'bg-indigo-500' : 'bg-white/10'}`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow
                      transition-all
                      ${formData.autoSave ? 'left-[22px]' : 'left-0.5'}`}
                  />
                </button>
              </label>

              {formData.autoSave && (
                <div>
                  <label className="block text-white/60 text-xs mb-1.5">
                    自动保存间隔（秒）
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
            <h3 className="text-white/90 font-semibold text-sm mb-4 flex items-center gap-2">
              <Bell size={16} className="text-indigo-400" />
              通知
            </h3>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-white/60 text-sm">显示通知</span>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, showNotifications: !formData.showNotifications })}
                className={`w-11 h-6 rounded-full transition-all relative
                  ${formData.showNotifications ? 'bg-indigo-500' : 'bg-white/10'}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow
                    transition-all
                    ${formData.showNotifications ? 'left-[22px]' : 'left-0.5'}`}
                />
              </button>
            </label>
          </div>

          <div className="h-px bg-white/5" />

          {/* 安全 */}
          <div>
            <h3 className="text-white/90 font-semibold text-sm mb-4 flex items-center gap-2">
              <Shield size={16} className="text-indigo-400" />
              安全
            </h3>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-white/60 text-sm">删除前确认</span>
              <button
                type="button"
                onClick={() =>
                  setFormData({ ...formData, confirmBeforeDelete: !formData.confirmBeforeDelete })
                }
                className={`w-11 h-6 rounded-full transition-all relative
                  ${formData.confirmBeforeDelete ? 'bg-indigo-500' : 'bg-white/10'}`}
              >
                <div
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow
                    transition-all
                    ${formData.confirmBeforeDelete ? 'left-[22px]' : 'left-0.5'}`}
                />
              </button>
            </label>
          </div>

          <div className="h-px bg-white/5" />

          {/* 执行器 */}
          <div>
            <h3 className="text-white/90 font-semibold text-sm mb-4 flex items-center gap-2">
              <RotateCcw size={16} className="text-indigo-400" />
              执行器
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-white/60 text-xs mb-1.5">默认节点超时（秒）</label>
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
                <label className="block text-white/60 text-xs mb-1.5">最大并发执行数</label>
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
            <h3 className="text-white/90 font-semibold text-sm mb-4">日志</h3>
            <div>
              <label className="block text-white/60 text-xs mb-1.5">日志保留天数</label>
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
            重置默认
          </button>
          <button
            type="button"
            onClick={handleSave}
            className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-all
              ${saved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white hover:shadow-lg hover:shadow-indigo-500/30'
              }`}
          >
            {saved ? '已保存' : '保存设置'}
          </button>
        </div>
      </GlassPanel>
    </div>
  )
}
