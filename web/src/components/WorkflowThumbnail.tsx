import { memo, useEffect, useId, useRef, useState } from 'react'
import {
  buildThumbnailGraph,
  THUMBNAIL_NODE_SIZE,
  type ThumbnailGraph,
} from '@/utils/pipelineThumbnail'
import { cn } from '@/utils/cn'

// 布局结果缓存：列表滚动/重渲染会反复挂载卡片，避免重复解析 YAML 与重算布局
const cache = new Map<string, ThumbnailGraph | null>()
const CACHE_LIMIT = 200

function getThumbnail(yamlConfig: string): ThumbnailGraph | null {
  if (cache.has(yamlConfig)) return cache.get(yamlConfig) ?? null
  let result: ThumbnailGraph | null = null
  try {
    result = buildThumbnailGraph(yamlConfig)
  } catch {
    result = null
  }
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(yamlConfig, result)
  return result
}

interface WorkflowThumbnailProps {
  yamlConfig: string
  className?: string
}

/**
 * 流水线结构缩略图：只读、无交互。
 * 解析在进入视口后才进行，50 条列表首屏不会一次性解析全部 YAML。
 */
function WorkflowThumbnail({ yamlConfig, className }: WorkflowThumbnailProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // mask 的 url(#id) 是文档级引用，多张卡片必须用唯一 id（useId 含冒号，去掉更稳）
  const maskId = `thumb-mask-${useId().replace(/:/g, '')}`
  const [visible, setVisible] = useState(() => cache.has(yamlConfig))
  const [graph, setGraph] = useState<ThumbnailGraph | null | undefined>(() =>
    cache.has(yamlConfig) ? cache.get(yamlConfig) : undefined
  )

  // 进入视口前不解析
  useEffect(() => {
    if (visible) return
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    setGraph(getThumbnail(yamlConfig))
  }, [visible, yamlConfig])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden rounded-lg bg-black/20 border border-white/5',
        className
      )}
    >
      {graph === undefined ? (
        <div className="absolute inset-0 animate-pulse bg-white/[0.03]" />
      ) : graph === null ? (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/20">
          —
        </div>
      ) : (
        <svg
          viewBox={graph.viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full"
          aria-hidden="true"
        >
          {/* 节点区域挖空：连线中心到中心绘制，但不得盖住节点与文字 */}
          <defs>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={graph.width}
              height={graph.height}
            >
              <rect x={0} y={0} width={graph.width} height={graph.height} fill="white" />
              {graph.nodes.map((n) => (
                <rect
                  key={n.id}
                  x={n.x - 1}
                  y={n.y - 1}
                  width={THUMBNAIL_NODE_SIZE.width + 2}
                  height={THUMBNAIL_NODE_SIZE.height + 2}
                  rx={15}
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <g mask={`url(#${maskId})`}>
            {graph.edges.map((e) => (
              <line
                key={e.id}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={1.5}
                strokeDasharray={e.dashed ? '5 5' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          {graph.nodes.map((n) => (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={THUMBNAIL_NODE_SIZE.width}
                height={THUMBNAIL_NODE_SIZE.height}
                rx={14}
                fill="rgba(255,255,255,0.06)"
                stroke="rgba(255,255,255,0.16)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={n.x + 18}
                y={n.y + THUMBNAIL_NODE_SIZE.height / 2 + 10}
                fontSize={30}
                fill="rgba(255,255,255,0.55)"
              >
                {n.label}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}

export default memo(WorkflowThumbnail)
