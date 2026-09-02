import { memo, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NodeWidgetHandle, NodeWidgetMount, NodeWidgetProps } from '@/types/nodeWidget'

/**
 * ModuleNodeWidget — 节点自定义 UI 组件宿主（module 模式）。
 *
 * 加载节点包携带的单文件 JS bundle（GET /api/v1/nodes/:id/ui/<entry>），
 * 在容器 div 上调用其 mount(el, props)，props 变化时调 update(props)，
 * 卸载时调 unmount()。bundle 格式不限制：
 *   - ESM：默认导出 mount 函数
 *   - IIFE/UMD：加载后调用 window.FlowXNodeWidget.define(mount) 注册
 * 加载或运行出错时显示警示条，不影响节点卡片其余部分。
 */

// 模块级加载缓存：同一 bundle URL 只加载一次（画布上同包多实例共享）
const moduleCache = new Map<string, Promise<NodeWidgetMount>>()

// 序列化加载队列：IIFE 通过全局槽位注册 mount，并发加载会串扰，故串行执行
let loadQueue: Promise<NodeWidgetMount> | null = null

declare global {
  interface Window {
    FlowXNodeWidget?: { define: (mount: NodeWidgetMount) => void }
    __flowxPendingWidget?: NodeWidgetMount | null
  }
}

function ensureGlobalRegistry() {
  if (!window.FlowXNodeWidget) {
    window.FlowXNodeWidget = {
      define(mount: NodeWidgetMount) {
        window.__flowxPendingWidget = mount
      },
    }
  }
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`failed to load script: ${url}`))
    document.head.appendChild(script)
  })
}

async function doLoad(url: string): Promise<NodeWidgetMount> {
  ensureGlobalRegistry()
  window.__flowxPendingWidget = null

  let mod: Record<string, unknown> | null = null
  try {
    // ESM 与 IIFE/UMD 均可作为 module 导入（后者仅执行副作用、无导出）
    mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>
  } catch {
    // 少数 bundle 语法无法作为 module 解析，回退到 script 标签加载
    await loadScript(url)
  }

  const fromExport = typeof mod?.default === 'function' ? (mod.default as NodeWidgetMount) : null
  const mount = fromExport || window.__flowxPendingWidget || null
  window.__flowxPendingWidget = null

  if (!mount) {
    throw new Error('widget bundle has no default export and did not call FlowXNodeWidget.define()')
  }
  return mount
}

export function loadWidgetBundle(url: string): Promise<NodeWidgetMount> {
  const cached = moduleCache.get(url)
  if (cached) return cached
  const prev: Promise<unknown> = loadQueue || Promise.resolve()
  const promise = prev.catch(() => undefined).then(() => doLoad(url))
  loadQueue = promise
  moduleCache.set(url, promise)
  // 失败时清除缓存，允许后续重试
  promise.catch(() => moduleCache.delete(url))
  return promise
}

/** 构造节点 UI bundle 的加载 URL（v 参数用于缓存破坏，通常传节点 updatedAt） */
export function buildWidgetUrl(nodeDbId: string, entry: string, version?: string): string {
  const v = version ? `?v=${encodeURIComponent(version)}` : ''
  return `/api/v1/nodes/${nodeDbId}/ui/${entry}${v}`
}

interface ModuleNodeWidgetProps {
  /** bundle 加载 URL，见 buildWidgetUrl */
  url: string
  width: number
  height: number
  widgetProps: NodeWidgetProps
}

const ModuleNodeWidget = memo(({ url, width, height, widgetProps }: ModuleNodeWidgetProps) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<NodeWidgetHandle | null>(null)
  const propsRef = useRef(widgetProps)
  propsRef.current = widgetProps
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 挂载：url 变化时重新加载并挂载（?v= 缓存破坏使重新导入后 url 变化）
  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoading(true)

    loadWidgetBundle(url)
      .then((mount) => {
        if (cancelled || !containerRef.current) return
        try {
          handleRef.current = mount(containerRef.current, propsRef.current) || {}
          setLoading(false)
        } catch (err) {
          console.error('[ModuleNodeWidget] mount failed:', err)
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[ModuleNodeWidget] load failed:', err)
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
      try {
        handleRef.current?.unmount?.()
      } catch (err) {
        console.error('[ModuleNodeWidget] unmount failed:', err)
      }
      handleRef.current = null
      // 组件未正确清理时兜底清空容器
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [url])

  // 数据推送：props 内容变化时调用组件的 update()
  const propsKey = JSON.stringify(widgetProps)
  useEffect(() => {
    if (!handleRef.current?.update) return
    try {
      handleRef.current.update(propsRef.current)
    } catch (err) {
      console.error('[ModuleNodeWidget] update failed:', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsKey])

  if (error) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20"
        style={{ width }}
      >
        <AlertTriangle size={12} className="text-rose-400 flex-shrink-0" />
        <span className="text-[10px] text-rose-300/80 truncate" title={error}>
          {t('canvas.widgetLoadFailed')}: {error}
        </span>
      </div>
    )
  }

  return (
    <div className="relative" style={{ width, height }}>
      <div
        ref={containerRef}
        // nodrag/nowheel：防止组件内的拖拽/滚轮被 React Flow 画布接管
        className="nodrag nowheel rounded-lg overflow-hidden"
        style={{ width, height }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/[0.03] border border-white/5 pointer-events-none">
          <Loader2 size={18} className="animate-spin text-white/30" />
        </div>
      )}
    </div>
  )
})

ModuleNodeWidget.displayName = 'ModuleNodeWidget'

export default ModuleNodeWidget
