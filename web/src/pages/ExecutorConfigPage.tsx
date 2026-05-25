import { useState } from 'react'
import { motion } from 'framer-motion'
import { Server, Container, Cloud } from 'lucide-react'
import ExecutorList from '@/features/executor-config/ExecutorList'
import ExecutorForm from '@/features/executor-config/ExecutorForm'
import ExecutorMonitor from '@/features/executor-config/ExecutorMonitor'

const executorTypes = [
  { id: 'local', name: 'Local', icon: Server, description: '本地 Shell 执行器' },
  { id: 'docker', name: 'Docker', icon: Container, description: 'Docker 容器执行器' },
  { id: 'kubernetes', name: 'Kubernetes', icon: Cloud, description: 'K8s Pod 执行器' },
]

export default function ExecutorConfigPage() {
  const [selectedExecutor, setSelectedExecutor] = useState<string>('local')

  return (
    <div className="h-full flex p-6 gap-6">
      {/* 执行器列表 */}
      <div className="w-80 flex-shrink-0 space-y-3">
        <h2 className="text-white/90 font-semibold text-lg mb-4">执行器</h2>
        {executorTypes.map((type) => {
          const Icon = type.icon
          const isActive = selectedExecutor === type.id

          return (
            <motion.button
              key={type.id}
              onClick={() => setSelectedExecutor(type.id)}
              className={`
                w-full p-4 rounded-2xl text-left transition-all
                ${isActive
                  ? 'bg-white/10 border border-white/20'
                  : 'bg-white/5 border border-white/10 hover:bg-white/[0.07]'
                }
              `}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`
                    w-10 h-10 rounded-xl flex items-center justify-center
                    ${isActive
                      ? 'bg-gradient-to-br from-indigo-500 to-purple-500'
                      : 'bg-white/5'
                    }
                  `}
                >
                  <Icon size={20} className={isActive ? 'text-white' : 'text-white/50'} />
                </div>
                <div>
                  <div className="text-white/90 font-medium text-sm">{type.name}</div>
                  <div className="text-white/40 text-xs mt-0.5">{type.description}</div>
                </div>
              </div>
            </motion.button>
          )
        })}
      </div>

      {/* 配置表单 */}
      <div className="flex-1 flex flex-col gap-6">
        <ExecutorForm type={selectedExecutor} />
        <ExecutorMonitor type={selectedExecutor} />
      </div>
    </div>
  )
}
