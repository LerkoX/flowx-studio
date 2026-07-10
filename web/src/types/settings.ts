export interface SystemSettings {
  theme: 'dark' | 'light' | 'system'
  language: string
  autoSave: boolean
  autoSaveInterval: number
  showNotifications: boolean
  confirmBeforeDelete: boolean
  defaultNodeTimeout: number
  maxConcurrentExecutions: number
  logRetentionDays: number
}
