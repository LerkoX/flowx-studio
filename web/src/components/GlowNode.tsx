import { memo } from 'react'
import { motion } from 'framer-motion'
import { Handle, Position, type NodeProps } from '@xyflow/react'

interface GlowNodeData {
  id: string
  name: string
  description?: string
  status: 'idle' | 'running' | 'success' | 'failed' | 'skipped'
  language?: string
  icon?: string
  accentColor?: string
}

const statusConfig = {
  idle: { color: '#94a3b8', glow: 'none' },
  running: { color: '#22d3ee', glow: 'cyan' },
  success: { color: '#34d399', glow: 'emerald' },
  failed: { color: '#fb7185', glow: 'rose' },
  skipped: { color: '#64748b', glow: 'none' },
}

const GlowNode = memo(({ data, selected }: NodeProps<GlowNodeData>) => {
  const { name, description, status, language, accentColor = '#6366f1' } = data
  const config = statusConfig[status]

  return (
    <motion.div
      className="relative"
      initial={{ scale: 0.85, opacity: 0, y: 10 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25, mass: 0.8 }}
    >
      {/* 选中高亮发光层 */}
      {selected && (
        <div
          className="absolute -inset-[2px] rounded-[22px]"
          style={{
            background: `linear-gradient(135deg, ${config.color}60, ${config.color}20)`,
            opacity: 0.6,
            filter: 'blur(4px)',
          }}
        />
      )}

      {/* 节点主体 */}
      <div
        className={`
          relative rounded-[20px] p-4 min-w-[200px] max-w-[280px]
          bg-white/[0.08] border border-white/10
          backdrop-blur-xl
          transition-all duration-300
          ${selected ? 'border-white/30' : ''}
        `}
        style={{
          boxShadow: selected
            ? `0 0 20px ${config.color}40, inset 0 1px 0 rgba(255,255,255,0.05)`
            : 'inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* 顶部彩色条 */}
        <div
          className="absolute top-0 left-5 right-5 h-[2px] rounded-b-sm"
          style={{ background: accentColor }}
        />

        {/* 输入连接点 */}
        <Handle
          type="target"
          position={Position.Top}
          className="w-3 h-3 !bg-white/20 !border-white/30"
        />

        {/* 节点内容 */}
        <div className="flex items-start gap-3">
          {/* 图标 */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}80)` }}
          >
            <span className="text-white text-lg">
              {data.icon || '◆'}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-white/90 font-semibold text-sm truncate">{name}</div>
            {description && (
              <div className="text-white/40 text-xs truncate mt-1">{description}</div>
            )}
            <div className="flex items-center gap-2 mt-2">
              {language && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/50 border border-white/10">
                  {language}
                </span>
              )}
              <span
                className="text-[10px] px-2 py-0.5 rounded-full border"
                style={{
                  color: config.color,
                  borderColor: `${config.color}40`,
                  background: `${config.color}10`,
                }}
              >
                {status === 'running' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1" />}
                {status}
              </span>
            </div>
          </div>
        </div>

        {/* 输出连接点 */}
        <Handle
          type="source"
          position={Position.Bottom}
          className="w-3 h-3 !bg-white/20 !border-white/30"
        />
      </div>
    </motion.div>
  )
})

GlowNode.displayName = 'GlowNode'

export default GlowNode
