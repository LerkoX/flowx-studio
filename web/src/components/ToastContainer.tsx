import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { useToastStore, type ToastType } from '@/stores/toastStore'

const styles: Record<ToastType, { icon: typeof Info; className: string }> = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-500/30 text-emerald-400',
  },
  error: {
    icon: AlertCircle,
    className: 'border-rose-500/30 text-rose-400',
  },
  info: {
    icon: Info,
    className: 'border-indigo-500/30 text-indigo-400',
  },
}

/** 全局通知容器（挂载于 App 根部） */
export default function ToastContainer() {
  const { toasts, remove } = useToastStore()

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2rem)]">
      <AnimatePresence>
        {toasts.map((t) => {
          const { icon: Icon, className } = styles[t.type]
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl
                         bg-panel/95 backdrop-blur-2xl border shadow-lg shadow-black/20 ${className}`}
            >
              <Icon size={16} className="flex-shrink-0" />
              <span className="text-white/90 text-sm break-all">{t.message}</span>
              <button
                onClick={() => remove(t.id)}
                className="flex-shrink-0 text-white/40 hover:text-white/80 transition-colors"
              >
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
