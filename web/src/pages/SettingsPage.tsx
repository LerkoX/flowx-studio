import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import SystemSettingsTab from '@/features/settings/SystemSettingsTab'

export default function SettingsPage() {
  const { t } = useTranslation()

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full overflow-auto"
    >
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white/90">{t('settings.title')}</h1>
          <p className="text-white/40 text-sm mt-1">{t('settings.subtitle')}</p>
        </div>

        <SystemSettingsTab />
      </div>
    </motion.div>
  )
}
