import { motion } from 'framer-motion'

interface StreamingTextProps {
  content: string
}

export default function StreamingText({ content }: StreamingTextProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex gap-3"
    >
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
        <div className="text-sm text-white/90 whitespace-pre-wrap">{content}</div>
        <span className="inline-block w-2 h-4 bg-indigo-400 ml-0.5 animate-pulse" />
      </div>
    </motion.div>
  )
}
