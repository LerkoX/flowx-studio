import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useIsMobile } from '@/hooks/useMediaQuery'

interface GlowNodeData {
  id: string
  name: string
  description?: string
  status: 'idle' | 'running' | 'success' | 'failed' | 'skipped'
  language?: string
  icon?: string
  accentColor?: string
  inputs?: string[]
  outputs?: Record<string, string>
}

const statusConfig = {
  idle: { color: '#94a3b8', glow: 'none' },
  running: { color: '#22d3ee', glow: 'cyan' },
  success: { color: '#34d399', glow: 'emerald' },
  failed: { color: '#fb7185', glow: 'rose' },
  skipped: { color: '#64748b', glow: 'none' },
}

const GlowNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as GlowNodeData
  const { name, description, status, language, accentColor = '#6366f1' } = nodeData
  const config = statusConfig[status]
  const isMobile = useIsMobile()
  const [detailsExpanded, setDetailsExpanded] = useState(false)

  const hasInputs = nodeData.inputs && nodeData.inputs.length > 0
  const hasOutputs = nodeData.outputs && Object.keys(nodeData.outputs).length > 0
  const hasDetails = hasInputs || hasOutputs

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
          relative rounded-[20px] p-3
          bg-white/[0.08] border border-white/10
          backdrop-blur-xl
          transition-all duration-300
          ${selected ? 'border-white/30' : ''}
          ${isMobile ? 'min-w-[140px] max-w-[200px]' : 'min-w-[200px] max-w-[280px]'}
        `}
        style={{
          boxShadow: selected
            ? `0 0 20px ${config.color}40, inset 0 1px 0 rgba(255,255,255,0.05)`
            : 'inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* 顶部彩色条 */}
        <div
          className="absolute top-0 left-4 right-4 h-[2px] rounded-b-sm"
          style={{ background: accentColor }}
        />

        {/* 输入连接点 */}
        <Handle
          type="target"
          position={Position.Top}
          className="w-3 h-3 !bg-white/20 !border-white/30"
        />

        {/* 节点内容 */}
        <div className="flex items-start gap-2">
          {/* 图标 */}
          <div
            className={`rounded-full flex items-center justify-center flex-shrink-0
                        ${isMobile ? 'w-8 h-8' : 'w-10 h-10'}`}
            style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}80)` }}
          >
            <span className={`text-white ${isMobile ? 'text-base' : 'text-lg'}`}>
              {nodeData.icon || '◆'}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className={`text-white/90 font-semibold truncate ${isMobile ? 'text-xs' : 'text-sm'}`}>{name}</div>
            {description && (
              <div className={`text-white/40 truncate mt-0.5 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>{description}</div>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {language && (
                <span className={`px-1.5 py-0.5 rounded-full bg-white/5 text-white/50 border border-white/10
                                  ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}>
                  {language}
                </span>
              )}
              <span
                className={`px-1.5 py-0.5 rounded-full border ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}
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

        {/* 入参与返回数据 */}
        {hasDetails && (
          <div className="mt-2 pt-2 border-t border-white/10">
            {isMobile ? (
              <>
                {/* 移动端摘要行 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDetailsExpanded(!detailsExpanded)
                  }}
                  className="w-full flex items-center justify-between text-[10px] text-white/40 hover:text-white/60 transition-colors"
                >
                  <span>
                    {hasInputs && `入参 ${nodeData.inputs!.length}`}
                    {hasInputs && hasOutputs && ' | '}
                    {hasOutputs && `返回 ${Object.keys(nodeData.outputs!).length}`}
                  </span>
                  {detailsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>

                {/* 移动端展开内容 */}
                {detailsExpanded && (
                  <div className="mt-2">
                    {hasInputs && (
                      <div className="mb-2">
                        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">入参</div>
                        <div className="flex flex-wrap gap-1">
                          {nodeData.inputs!.map((input) => (
                            <span
                              key={input}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 border border-white/5"
                            >
                              {input}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {hasOutputs && (
                      <div>
                        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">返回</div>
                        <div className="space-y-1">
                          {Object.entries(nodeData.outputs!).map(([key, value]) => (
                            <div key={key} className="flex items-center gap-2 text-[10px]">
                              <span className="text-white/40 font-mono">{key}:</span>
                              <span className="text-white/60 font-mono truncate">{String(value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* 桌面端：完整显示 */
              <>
                {hasInputs && (
                  <div className="mb-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">入参</div>
                    <div className="flex flex-wrap gap-1">
                      {nodeData.inputs!.map((input) => (
                        <span
                          key={input}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 border border-white/5"
                        >
                          {input}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {hasOutputs && (
                  <div>
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">返回</div>
                    <div className="space-y-1">
                      {Object.entries(nodeData.outputs!).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2 text-[10px]">
                          <span className="text-white/40 font-mono">{key}:</span>
                          <span className="text-white/60 font-mono truncate">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
})

GlowNode.displayName = 'GlowNode'

export default GlowNode
