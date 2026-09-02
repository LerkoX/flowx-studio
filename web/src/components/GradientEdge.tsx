import { memo } from 'react'
import { type EdgeProps, getBezierPath, EdgeLabelRenderer } from '@xyflow/react'
import { Repeat } from 'lucide-react'

/**
 * 流水线连线：
 * - 目标端箭头 + 常驻慢速虚线流动（沿 source → target 方向）指示流水线方向
 * - 源节点运行中：渐变高亮 + 加速流动
 * - 目标节点失败：红色调
 * - 两端节点均已运行成功：实线、无流动效果（表示流已走过）
 * - 携带条件标签时（loop 回环等）在线条中点渲染琥珀色胶囊
 */
const GradientEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  const edgeData = (data as Record<string, unknown>) ?? {}
  const isAnimated = edgeData.animated === true
  const isFailed = edgeData.status === 'failed'
  const isTraversed = edgeData.traversed === true
  const label = typeof edgeData.label === 'string' ? edgeData.label : undefined

  const idleColor = 'rgba(255,255,255,0.25)'
  const traversedColor = 'rgba(52,211,153,0.55)'
  const stroke = isFailed
    ? 'rgba(251,113,133,0.7)'
    : isAnimated
      ? `url(#gradient-${id})`
      : isTraversed
        ? traversedColor
        : idleColor
  const arrowFill = isFailed
    ? 'rgba(251,113,133,0.8)'
    : isAnimated
      ? '#a855f7'
      : isTraversed
        ? 'rgba(52,211,153,0.7)'
        : 'rgba(255,255,255,0.4)'

  return (
    <>
      {/* 渐变与箭头定义 */}
      <defs>
        <linearGradient id={`gradient-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <marker
          id={`arrow-${id}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0.8 1.2 L 8.8 5 L 0.8 8.8 z" fill={arrowFill} />
        </marker>
      </defs>

      {/* 连线：dasharray 周期均为 16，配合 edgeFlow 关键帧沿路径方向流动；
          已流过（两端均成功）为实线无动画 */}
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        stroke={stroke}
        strokeWidth={isAnimated ? 3.5 : 3}
        fill="none"
        markerEnd={`url(#arrow-${id})`}
        style={{
          filter: isAnimated ? 'drop-shadow(0 0 4px rgba(34,211,238,0.6))' : 'none',
          strokeDasharray: isAnimated ? '10 6' : isTraversed ? 'none' : '4 12',
          animation: isAnimated
            ? 'edgeFlow 0.4s linear infinite'
            : isTraversed
              ? 'none'
              : 'edgeFlow 1.5s linear infinite',
          opacity: isFailed ? 0.9 : isAnimated ? 1 : isTraversed ? 0.85 : 0.7,
        }}
      />

      {/* 条件标签（loop 回环条件等） */}
      {label && (
        <EdgeLabelRenderer>
          <div
            title={label}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="absolute flex items-center gap-1 px-2 py-0.5 rounded-full
              bg-amber-400/10 border border-amber-400/40 backdrop-blur-md
              text-amber-300 text-[10px] font-mono whitespace-nowrap
              max-w-[180px] overflow-hidden text-ellipsis
              shadow-[0_0_8px_rgba(251,191,36,0.25)] pointer-events-auto"
          >
            <Repeat className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate">{label}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

GradientEdge.displayName = 'GradientEdge'

export default GradientEdge
