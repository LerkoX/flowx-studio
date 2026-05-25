import { cn } from '@/utils/cn'

interface GlassPanelProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
}

export default function GlassPanel({ children, className, hover = false }: GlassPanelProps) {
  return (
    <div
      className={cn(
        'bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[20px]',
        hover && 'transition-all duration-300 hover:bg-white/[0.08] hover:border-white/20 hover:shadow-[0_8px_32px_rgba(99,102,241,0.15)]',
        className
      )}
    >
      {children}
    </div>
  )
}
