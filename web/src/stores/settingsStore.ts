import { create } from 'zustand'
import type { SystemSettings } from '@/types/settings'
import { getSystemConfig, updateSystemConfig } from '@/services/configService'

interface SettingsState {
  systemSettings: SystemSettings
  loaded: boolean
  isLoading: boolean
  error: string | null
  updateSystemSettings: (settings: Partial<SystemSettings>) => Promise<void>
  loadSystemSettings: () => Promise<void>
}

export const defaultSystemSettings: SystemSettings = {
  theme: 'dark',
  language: 'zh-CN',
  autoSave: true,
  autoSaveInterval: 30,
  showNotifications: true,
  confirmBeforeDelete: true,
  defaultNodeTimeout: 300,
  maxConcurrentExecutions: 5,
  logRetentionDays: 7,
}

// SystemSettings（camelCase）→ system_configs 键（snake_case）
function toConfigMap(settings: Partial<SystemSettings>): Record<string, string> {
  const map: Record<string, string> = {}
  if (settings.theme !== undefined) map.theme = settings.theme
  if (settings.language !== undefined) map.language = settings.language
  if (settings.autoSave !== undefined) map.auto_save = String(settings.autoSave)
  if (settings.autoSaveInterval !== undefined) map.auto_save_interval = String(settings.autoSaveInterval)
  if (settings.showNotifications !== undefined) map.show_notifications = String(settings.showNotifications)
  if (settings.confirmBeforeDelete !== undefined) map.confirm_before_delete = String(settings.confirmBeforeDelete)
  if (settings.defaultNodeTimeout !== undefined) map.default_node_timeout = String(settings.defaultNodeTimeout)
  if (settings.maxConcurrentExecutions !== undefined)
    map.max_concurrent_executions = String(settings.maxConcurrentExecutions)
  if (settings.logRetentionDays !== undefined) map.log_retention_days = String(settings.logRetentionDays)
  return map
}

function fromConfigMap(data: Record<string, string>): SystemSettings {
  const bool = (v: string | undefined, def: boolean) => (v === undefined ? def : v === 'true')
  const int = (v: string | undefined, def: number) => {
    const n = parseInt(v ?? '', 10)
    return Number.isNaN(n) ? def : n
  }
  return {
    theme: (data.theme || 'dark') as SystemSettings['theme'],
    language: data.language || 'zh-CN',
    autoSave: bool(data.auto_save, true),
    autoSaveInterval: int(data.auto_save_interval, 30),
    showNotifications: bool(data.show_notifications, true),
    confirmBeforeDelete: bool(data.confirm_before_delete, true),
    defaultNodeTimeout: int(data.default_node_timeout, 300),
    maxConcurrentExecutions: int(data.max_concurrent_executions, 5),
    logRetentionDays: int(data.log_retention_days, 7),
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  systemSettings: defaultSystemSettings,
  loaded: false,
  isLoading: false,
  error: null,

  updateSystemSettings: async (settings) => {
    set({ error: null })
    try {
      await updateSystemConfig(toConfigMap(settings))
      set((state) => ({
        systemSettings: { ...state.systemSettings, ...settings },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update system settings'
      set({ error: message })
      throw error
    }
  },

  loadSystemSettings: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await getSystemConfig()
      if (response.code === 200 && response.data) {
        set({ systemSettings: fromConfigMap(response.data), loaded: true })
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to load system settings' })
    } finally {
      set({ isLoading: false })
    }
  },
}))
