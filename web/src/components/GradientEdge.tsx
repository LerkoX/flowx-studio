import { memo } from 'react'
import { type EdgeProps, getBezierPath } from '@xyflow/react'

const GradientEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) => {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  const isAnimated = (data as Record<string, unknown>)?.animated === true
  const isActive = (data as Record<string, unknown>)?.status === 'active'

  return (
    <>
      {/* 定义渐变 */}
      <defs>
        <linearGradient id={`gradient-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>

      {/* 连线 */}
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        stroke={isActive ? `url(#gradient-${id})` : 'rgba(255,255,255,0.2)'}
        strokeWidth={isActive ? 2.5 : 2}
        fill="none"
        markerEnd={markerEnd}
        style={{
          filter: isActive ? 'drop-shadow(0 0 4px rgba(34,211,238,0.6))' : 'none',
          strokeDasharray: isAnimated ? '10 5' : 'none',
          animation: isAnimated ? 'flowDash 1s linear infinite' : 'none',
        }}
      />
    </>
  )
})

GradientEdge.displayName = 'GradientEdge'

export default GradientEdge
