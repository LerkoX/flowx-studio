import { motion } from 'framer-motion'
import { Play, Pause, RotateCcw, Download } from 'lucide-react'

interface AIAction {
  id: string
  type: 'run' | 'pause' | 'retry' | 'export'
  label: string
}

interface AIActionButtonsProps {
  actions?: AIAction[]
  onAction?: (action: AIAction) => void
}

const defaultActions: AIAction[] = [
  { id: 'run', type: 'run', label: '运行' },
  { id: 'pause', type: 'pause', label: '暂停' },
  { id: 'retry', type: 'retry', label: '重试' },
  { id: 'export', type: 'export', label: '导出' },
]

const iconMap = {
  run: Play,
  pause: Pause,
  retry: RotateCcw,
  export: Download,
}

export default function AIActionButtons({ actions = defaultActions, onAction }: AIActionButtonsProps) {
  return (
    <div className="flex gap-2 mt-3">
      {actions.map((action) => {
        const Icon = iconMap[action.type]
        return (
          <motion.button
            key={action.id}
            onClick={() => onAction?.(action)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                       bg-white/5 border border-white/10
                       text-white/60 text-xs
                       hover:bg-white/10 hover:text-white hover:border-white/20
                       transition-all"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Icon size={14} />
            {action.label}
          </motion.button>
        )
      })}
    </div>
  )
}
