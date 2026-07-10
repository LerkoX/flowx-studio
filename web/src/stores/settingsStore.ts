import { create } from 'zustand'
import type { SystemSettings } from '@/types/settings'
import { getSystemConfig, updateSystemConfig } from '@/services/configService'

interface SettingsState {
  systemSettings: SystemSettings
  isLoading: boolean
  error: string | null
  updateSystemSettings: (settings: Partial<SystemSettings>) => Promise<void>
  loadSystemSettings: () => Promise<void>
}

const defaultSystemSettings: SystemSettings = {
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

export const useSettingsStore = create<SettingsState>((set) => ({
  systemSettings: defaultSystemSettings,
  isLoading: false,
  error: null,

  updateSystemSettings: async (settings) => {
    try {
      const settingsMap: Record<string, string> = {}
      for (const [key, value] of Object.entries(settings)) {
        settingsMap[key] = String(value)
      }
      await updateSystemConfig(settingsMap)
      set((state) => ({
        systemSettings: { ...state.systemSettings, ...settings },
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update system settings' })
    }
  },

  loadSystemSettings: async () => {
    try {
      const response = await getSystemConfig()
      if (response.code === 200 && response.data) {
        const data = response.data
        set({
          systemSettings: {
            theme: (data.theme || 'dark') as SystemSettings['theme'],
            language: data.language || 'zh-CN',
            autoSave: data.auto_save === 'true',
            autoSaveInterval: parseInt(data.auto_save_interval || '30', 10),
            showNotifications: data.show_notifications === 'true',
            confirmBeforeDelete: data.confirm_before_delete === 'true',
            defaultNodeTimeout: parseInt(data.default_node_timeout || '300', 10),
            maxConcurrentExecutions: parseInt(data.max_concurrent_executions || '5', 10),
            logRetentionDays: parseInt(data.log_retention_days || '7', 10),
          },
        })
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to load system settings' })
    }
  },
}))
