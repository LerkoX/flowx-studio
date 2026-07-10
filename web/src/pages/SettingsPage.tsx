import { useState } from 'react'
import { motion } from 'framer-motion'
import { Settings } from 'lucide-react'
import SystemSettingsTab from '@/features/settings/SystemSettingsTab'

const tabs = [
  { id: 'system', label: '系统设置', icon: Settings },
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('system')

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full overflow-auto"
    >
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* 标题 */}
        <div>
          <h1 className="text-2xl font-bold text-white/90">设置</h1>
          <p className="text-white/40 text-sm mt-1">配置系统偏好</p>
        </div>

        {/* 标签切换 */}
        <div className="flex gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm
                  transition-all border
                  ${activeTab === tab.id
                    ? 'bg-white/10 border-white/20 text-white'
                    : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'
                  }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* 内容区域 */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'system' && <SystemSettingsTab />}
        </motion.div>
      </div>
    </motion.div>
  )
}
