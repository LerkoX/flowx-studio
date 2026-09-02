import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * 系统偏好生效组件（挂载于 App 根部）：
 * - theme: dark/light/system → 写 <html data-theme>，system 时跟随 prefers-color-scheme
 * - language: 切换 i18n 语言
 */
export default function SystemPreferencesEffect() {
  const theme = useSettingsStore((s) => s.systemSettings.theme)
  const language = useSettingsStore((s) => s.systemSettings.language)
  const { i18n } = useTranslation()

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')

    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme
      document.documentElement.dataset.theme = resolved
    }
    apply()

    if (theme === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
  }, [theme])

  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language)
    }
  }, [language, i18n])

  return null
}
