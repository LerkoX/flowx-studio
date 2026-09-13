import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import JsonViewer from '@/components/JsonViewer'

interface OutputExplorerProps {
  /** 节点返回值（值可能是字符串或已解析的对象/数组） */
  outputs: Record<string, unknown>
  /** 紧凑模式：画布节点卡片内使用，缩小字号与间距 */
  compact?: boolean
}

type ValueKind = 'json' | 'long' | 'short'

/** 超过该长度或含换行的纯文本按长文本渲染（等宽换行） */
const LONG_TEXT_THRESHOLD = 120

/**
 * 返回值分类：
 * - 对象/数组或可解析为对象/数组的 JSON 文本 → 格式化 + 语法高亮
 * - 长文本 → 等宽自动换行
 * - 其余短文本 → 直接展示
 */
function classifyValue(value: unknown): { kind: ValueKind; formatted: string } {
  if (value === null || value === undefined) return { kind: 'short', formatted: String(value) }
  if (typeof value === 'object') {
    return { kind: 'json', formatted: JSON.stringify(value, null, 2) }
  }
  const raw = String(value)
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed !== null && typeof parsed === 'object') {
        return { kind: 'json', formatted: JSON.stringify(parsed, null, 2) }
      }
    } catch {
      // 非 JSON，按文本处理
    }
  }
  if (raw.length > LONG_TEXT_THRESHOLD || raw.includes('\n')) {
    return { kind: 'long', formatted: raw }
  }
  return { kind: 'short', formatted: raw }
}

/**
 * 节点返回值浏览器：默认整体收缩（仅显示「返回 N」开关行），
 * 展开后显示 key 标签列表，点击标签弹出窗口查看格式化后的具体值。
 * 弹窗通过 createPortal 挂到 body：画布节点在 React Flow 的 transform 容器内，
 * fixed 定位会被 transform 捕获，必须脱离节点 DOM 树。
 */
export default function OutputExplorer({ outputs, compact = false }: OutputExplorerProps) {
  const { t } = useTranslation()
  const entries = useMemo(
    () => Object.entries(outputs).map(([key, value]) => ({ key, ...classifyValue(value) })),
    [outputs]
  )
  const [listExpanded, setListExpanded] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selected = entries.find((e) => e.key === selectedKey)

  if (entries.length === 0) return null

  return (
    <>
      {/* 收缩开关行 */}
      <button
        onClick={(ev) => {
          ev.stopPropagation()
          setListExpanded(!listExpanded)
        }}
        className={`flex items-center gap-1 text-white/40 hover:text-white/60 transition-colors ${
          compact ? 'text-[10px]' : 'text-xs'
        }`}
      >
        {listExpanded ? <ChevronUp size={compact ? 12 : 14} /> : <ChevronDown size={compact ? 12 : 14} />}
        {t('canvas.outputsCount', { count: entries.length })}
      </button>

      {/* key 标签列表（默认收缩） */}
      <AnimatePresence initial={false}>
        {listExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1 pt-1.5">
              {entries.map((e) => (
                <button
                  key={e.key}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    setSelectedKey(e.key)
                  }}
                  className={`flex items-center gap-1 rounded border font-mono transition-colors ${
                    compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'
                  } bg-white/5 border-white/5 text-white/50 hover:text-white/70 hover:bg-white/10`}
                >
                  <span>{e.key}</span>
                  <span
                    className={`rounded px-1 leading-tight ${
                      e.kind === 'json'
                        ? 'bg-emerald-500/15 text-emerald-400/80'
                        : 'bg-white/5 text-white/30'
                    } ${compact ? 'text-[8px]' : 'text-[10px]'}`}
                  >
                    {e.kind === 'json' ? 'json' : 'text'}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 值详情弹窗（portal 到 body，避免被节点 transform 捕获） */}
      {createPortal(
        <AnimatePresence>
          {selected && (
            <>
              <motion.div
                key="mask"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
                onClick={() => setSelectedKey(null)}
              />
              <motion.div
                key="panel"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-[80] flex items-center justify-center p-4 pointer-events-none"
              >
                <div
                  className="pointer-events-auto w-full max-w-2xl max-h-[70vh] flex flex-col
                             rounded-2xl bg-[#14161c] border border-white/10 shadow-2xl"
                >
                  {/* 标题栏 */}
                  <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm text-white/80 truncate">{selected.key}</span>
                      <span
                        className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-tight ${
                          selected.kind === 'json'
                            ? 'bg-emerald-500/15 text-emerald-400/80'
                            : 'bg-white/5 text-white/30'
                        }`}
                      >
                        {selected.kind === 'json' ? 'json' : 'text'}
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedKey(null)}
                      className="flex-shrink-0 p-1 rounded-md text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* 值内容 */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {selected.kind === 'json' ? (
                      <JsonViewer code={selected.formatted} />
                    ) : (
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-white/70">
                        {selected.formatted}
                      </pre>
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
