import { create } from 'zustand'
import type { AIProviderConfig, MCPConfig, SystemSettings } from '@/types/settings'
import {
  getAIConfigs,
  createAIConfig,
  updateAIConfig,
  deleteAIConfig,
  getMCPConfigs,
  createMCPConfig,
  updateMCPConfig,
  deleteMCPConfig,
  getSystemConfig,
  updateSystemConfig,
} from '@/services/configService'

interface SettingsState {
  aiProviders: AIProviderConfig[]
  mcpConfigs: MCPConfig[]
  systemSettings: SystemSettings
  activeTab: 'ai' | 'mcp' | 'system'
  isLoading: boolean
  error: string | null

  // AI Provider Actions
  addAIProvider: (config: AIProviderConfig) => Promise<void>
  updateAIProvider: (id: string, config: Partial<AIProviderConfig>) => Promise<void>
  deleteAIProvider: (id: string) => Promise<void>
  setActiveAIProvider: (id: string) => Promise<void>
  getActiveAIProvider: () => AIProviderConfig | undefined

  // MCP Config Actions
  addMCPConfig: (config: MCPConfig) => Promise<void>
  updateMCPConfig: (id: string, config: Partial<MCPConfig>) => Promise<void>
  deleteMCPConfig: (id: string) => Promise<void>
  toggleMCPConfig: (id: string) => void

  // System Settings Actions
  updateSystemSettings: (settings: Partial<SystemSettings>) => Promise<void>

  // Tab
  setActiveTab: (tab: 'ai' | 'mcp' | 'system') => void

  // Load
  loadAIProviders: () => Promise<void>
  loadMCPConfigs: () => Promise<void>
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

export const useSettingsStore = create<SettingsState>((set, get) => ({
  aiProviders: [],
  mcpConfigs: [],
  systemSettings: defaultSystemSettings,
  activeTab: 'ai',
  isLoading: false,
  error: null,

  addAIProvider: async (config) => {
    try {
      const response = await createAIConfig(config)
      if (response.code === 200 && response.data) {
        set((state) => ({
          aiProviders: [...state.aiProviders, { ...response.data, id: String(response.data.id) }],
        }))
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to add AI provider' })
    }
  },

  updateAIProvider: async (id, config) => {
    try {
      const response = await updateAIConfig(id, config)
      if (response.code === 200) {
        set((state) => ({
          aiProviders: state.aiProviders.map((p) =>
            p.id === id ? { ...p, ...config } : p
          ),
        }))
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update AI provider' })
    }
  },

  deleteAIProvider: async (id) => {
    try {
      await deleteAIConfig(id)
      set((state) => ({
        aiProviders: state.aiProviders.filter((p) => p.id !== id),
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete AI provider' })
    }
  },

  setActiveAIProvider: async (id) => {
    try {
      // 先取消所有 active
      for (const p of get().aiProviders) {
        if (p.isActive) {
          await updateAIConfig(p.id, { isActive: false })
        }
      }
      await updateAIConfig(id, { isActive: true })
      set((state) => ({
        aiProviders: state.aiProviders.map((p) => ({
          ...p,
          isActive: p.id === id,
        })),
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to set active AI provider' })
    }
  },

  getActiveAIProvider: () => {
    return get().aiProviders.find((p) => p.isActive && p.isEnabled)
  },

  addMCPConfig: async (config) => {
    try {
      const response = await createMCPConfig(config)
      if (response.code === 200 && response.data) {
        set((state) => ({
          mcpConfigs: [...state.mcpConfigs, { ...response.data, id: String(response.data.id) }],
        }))
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to add MCP config' })
    }
  },

  updateMCPConfig: async (id, config) => {
    try {
      const response = await updateMCPConfig(id, config)
      if (response.code === 200) {
        set((state) => ({
          mcpConfigs: state.mcpConfigs.map((c) =>
            c.id === id ? { ...c, ...config } : c
          ),
        }))
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update MCP config' })
    }
  },

  deleteMCPConfig: async (id) => {
    try {
      await deleteMCPConfig(id)
      set((state) => ({
        mcpConfigs: state.mcpConfigs.filter((c) => c.id !== id),
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete MCP config' })
    }
  },

  toggleMCPConfig: (id) =>
    set((state) => ({
      mcpConfigs: state.mcpConfigs.map((c) =>
        c.id === id ? { ...c, isEnabled: !c.isEnabled } : c
      ),
    })),

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

  setActiveTab: (tab) => set({ activeTab: tab }),

  loadAIProviders: async () => {
    try {
      const response = await getAIConfigs()
      if (response.code === 200 && response.data) {
        const providers = response.data.map((item: AIProviderConfig) => ({
          ...item,
          id: String(item.id),
        }))
        set({ aiProviders: providers })
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to load AI providers' })
    }
  },

  loadMCPConfigs: async () => {
    try {
      const response = await getMCPConfigs()
      if (response.code === 200 && response.data) {
        const configs = response.data.map((item) => ({
          ...item,
          id: String(item.id),
        }))
        set({ mcpConfigs: configs })
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to load MCP configs' })
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
