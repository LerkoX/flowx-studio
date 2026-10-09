import { memo } from 'react'
import { type EdgeProps, EdgeLabelRenderer } from '@xyflow/react'
import { Repeat } from 'lucide-react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useCanvasOverview } from '@/features/workflow-canvas/useCanvasOverview'
import { getRoutedBezierPath } from '@/features/workflow-canvas/edgeRouting'

/**
 * 流水线连线：
 * - 目标端箭头指示 source → target 方向
 * - 源节点运行中：渐变高亮 + 加速流动 + 霓虹呼吸光晕
 * - 目标节点失败：红色实线
 * - 两端节点均已运行成功：绿色实线、无流动效果（表示流已走过）
 * - 未执行：低透明度灰色虚线，退到背景层
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
  const isMobile = useIsMobile()
  // 低缩放时连线改用屏幕固定宽度；与节点概览使用同一套迟滞阈值
  const overviewMode = useCanvasOverview(isMobile)

  const edgeData = (data as Record<string, unknown>) ?? {}
  const controlOffset = typeof edgeData.controlOffset === 'number' ? edgeData.controlOffset : 0
  const [edgePath, labelX, labelY] = getRoutedBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    controlOffset,
  })

  const isAnimated = edgeData.animated === true
  const isFailed = edgeData.status === 'failed'
  const isTraversed = edgeData.traversed === true
  const label = typeof edgeData.label === 'string' ? edgeData.label : undefined

  const idleColor = 'rgba(255,255,255,0.32)'
  const traversedColor = 'rgba(52,211,153,0.72)'
  const failedColor = 'rgba(251,113,133,0.88)'
  const stroke = isFailed
    ? failedColor
    : isAnimated
      ? `url(#gradient-${id})`
      : isTraversed
        ? traversedColor
        : idleColor
  const arrowFill = isFailed
    ? 'rgba(251,113,133,0.9)'
    : isAnimated
      ? '#a855f7'
      : isTraversed
        ? 'rgba(52,211,153,0.8)'
        : 'rgba(255,255,255,0.42)'

  const strokeWidth = isFailed
    ? 4
    : isAnimated
      ? 4.5
      : isTraversed
        ? 3.5
        : 3
  const pathOpacity = isFailed
    ? 0.95
    : isAnimated
      ? 1
      : isTraversed
        ? 0.9
        : 0.36

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

      {/* 执行中的底层霓虹光晕：主线仍负责精确路径，光晕只负责状态识别 */}
      {isAnimated && (
        <path
          className="edge-neon-halo"
          d={edgePath}
          stroke={`url(#gradient-${id})`}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect={overviewMode ? 'non-scaling-stroke' : 'none'}
          pointerEvents="none"
        />
      )}

      {/* 连线：dasharray 周期均为 16，配合 edgeFlow 关键帧沿路径方向流动；
          已流过（两端均成功）为实线无动画，未执行为低透明度静态虚线 */}
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect={overviewMode ? 'non-scaling-stroke' : 'none'}
        markerEnd={`url(#arrow-${id})`}
        style={{
          filter: isAnimated
            ? 'drop-shadow(0 0 4px rgba(34,211,238,0.75)) drop-shadow(0 0 8px rgba(168,85,247,0.45))'
            : isFailed
              ? 'drop-shadow(0 0 4px rgba(251,113,133,0.35))'
              : 'none',
          strokeDasharray: isAnimated ? '10 6' : isFailed || isTraversed ? 'none' : '3 13',
          animation: isAnimated ? 'edgeFlow 0.35s linear infinite' : 'none',
          opacity: pathOpacity,
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
