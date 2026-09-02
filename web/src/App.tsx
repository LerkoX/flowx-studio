import { useEffect } from 'react'
import AppRouter from './router'
import SystemPreferencesEffect from '@/components/SystemPreferencesEffect'
import ToastContainer from '@/components/ToastContainer'
import { useSettingsStore } from '@/stores/settingsStore'

export default function App() {
  const loadSystemSettings = useSettingsStore((s) => s.loadSystemSettings)

  // 启动时加载系统偏好（主题/语言/编辑器/执行器等）
  useEffect(() => {
    loadSystemSettings()
  }, [loadSystemSettings])

  return (
    <>
      <SystemPreferencesEffect />
      <AppRouter />
      <ToastContainer />
    </>
  )
}
