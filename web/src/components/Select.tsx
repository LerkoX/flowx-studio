import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** 外层容器附加类（宽度等） */
  className?: string
  /** 触发按钮样式覆盖（圆角/字号/内边距），不传用默认尺寸 */
  triggerClassName?: string
}

/**
 * 自定义下拉选择器（替代原生 <select>，与 GlassPanel 风格统一）。
 * 点击外部 / Esc 关闭；选中项带 Check 高亮。
 * 注意：下拉面板为 absolute 定位，祖先容器若有 overflow-hidden 会被裁剪。
 */
export default function Select({ value, onChange, options, className = '', triggerClassName }: SelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between gap-2
                  bg-white/5 border border-white/10
                  hover:bg-white/[0.07] focus:outline-none focus:border-white/20
                  transition-all cursor-pointer
                  ${triggerClassName ?? 'px-3 py-2 rounded-lg text-xs text-white/80'}`}
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          size={12}
          className={`text-white/30 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full mt-1 z-50 min-w-full max-h-60 overflow-y-auto
                     bg-panel/95 backdrop-blur-2xl border border-white/10 rounded-xl
                     shadow-xl shadow-black/30 py-1"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors
                  ${opt.value === value
                    ? 'text-indigo-300 bg-indigo-500/10'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'}`}
              >
                <span className="truncate">{opt.label}</span>
                {opt.value === value && <Check size={12} className="flex-shrink-0" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
