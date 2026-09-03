import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useExecutionStore, type LogLevel } from '@/stores/executionStore'
import Select from '@/components/Select'
import type { ExecutionLog } from '@/types/execution'

const levelColors: Record<LogLevel, string> = {
  INFO: 'bg-emerald-400/20 text-emerald-400 border-emerald-400/30',
  WARN: 'bg-amber-400/20 text-amber-400 border-amber-400/30',
  ERROR: 'bg-rose-400/20 text-rose-400 border-rose-400/30',
  DEBUG: 'bg-slate-400/20 text-slate-400 border-slate-400/30',
  FATAL: 'bg-purple-400/20 text-purple-400 border-purple-400/30',
}

interface LogSegment {
  key: string
  nodeName: string
  logs: ExecutionLog[]
}

export default function LogViewer() {
  const { t } = useTranslation()
  const {
    executionLog,
    logsTotal,
    loadingOlder,
    loadingLogs,
    executionNodes,
    logFilter,
    setLogFilter,
    loadOlderLogs,
  } = useExecutionStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)
  // prepend 旧日志后保持视口停留在原内容的滚动补偿标记
  const prependPendingRef = useRef(false)
  const prevDistFromBottomRef = useRef(0)

  // 节点过滤与搜索已在服务端完成（分页懒加载下客户端过滤会漏数据），
  // 客户端只按级别过滤已加载的日志
  const filteredLogs = useMemo(
    () => executionLog.filter((log) => logFilter.levels.includes(log.level)),
    [executionLog, logFilter.levels]
  )

  // 按节点维度分段拼接：时间正序下节点名变化即开启新段，
  // 每段以节点名称作为标题，段内为该节点的连续日志
  const segments = useMemo(() => {
    const segs: LogSegment[] = []
    for (const log of filteredLogs) {
      const last = segs[segs.length - 1]
      if (last && last.nodeName === log.nodeName) {
        last.logs.push(log)
      } else {
        segs.push({ key: `${log.nodeName}-${log.id}`, nodeName: log.nodeName, logs: [log] })
      }
    }
    return segs
  }, [filteredLogs])

  const hasMore = executionLog.length < logsTotal

  // 日志变化时：prepend 旧日志 → 按「距底部距离不变」做滚动补偿；
  // 否则在自动滚动开启且用户未上翻时滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prependPendingRef.current) {
      el.scrollTop = el.scrollHeight - prevDistFromBottomRef.current
      prependPendingRef.current = false
      return
    }
    if (logFilter.autoScroll && !userScrolled) {
      el.scrollTop = el.scrollHeight
    }
  }, [filteredLogs, logFilter.autoScroll, userScrolled])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50
    setUserScrolled(!isNearBottom)
    // 滚动到顶部附近时懒加载更旧的日志
    if (scrollTop < 40 && hasMore && !loadingOlder) {
      prependPendingRef.current = true
      prevDistFromBottomRef.current = scrollHeight - scrollTop
      loadOlderLogs()
    }
  }, [hasMore, loadingOlder, loadOlderLogs])

  // 节点过滤选项：优先用执行节点列表（完整），其次从已加载日志中提取
  const nodeOptions = useMemo(() => {
    const map = new Map<string, string>()
    executionNodes.forEach((n) => {
      if (n.nodeId) map.set(n.nodeId, n.nodeName || n.nodeId)
    })
    if (map.size === 0) {
      executionLog.forEach((l) => {
        if (l.nodeName) map.set(l.nodeName, l.nodeName)
      })
    }
    return Array.from(map.entries())
  }, [executionNodes, executionLog])

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        {/* 搜索框（服务端过滤，覆盖未加载的旧日志） */}
        <div className="flex-1 relative">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder={t('logs.searchPlaceholder')}
            value={logFilter.searchQuery}
            onChange={(e) => setLogFilter({ searchQuery: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-2 py-1.5
                       text-xs text-white/80 placeholder:text-white/30
                       focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>

        {/* 级别过滤（客户端过滤已加载部分） */}
        <div className="flex gap-1">
          {(['INFO', 'WARN', 'ERROR', 'DEBUG', 'FATAL'] as LogLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => {
                const levels = logFilter.levels.includes(level)
                  ? logFilter.levels.filter((l) => l !== level)
                  : [...logFilter.levels, level]
                setLogFilter({ levels })
              }}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-all
                ${
                  logFilter.levels.includes(level)
                    ? levelColors[level]
                    : 'bg-white/5 text-white/30 border-white/10 hover:text-white/50'
                }`}
            >
              {level}
            </button>
          ))}
        </div>

        {/* 节点过滤（服务端过滤） */}
        {nodeOptions.length > 0 && (
          <div className="flex items-center gap-1">
            <Select
              value={logFilter.nodeFilter || ''}
              onChange={(v) => setLogFilter({ nodeFilter: v || null })}
              options={[
                { value: '', label: t('logs.allNodes') },
                ...nodeOptions.map(([value, label]) => ({ value, label })),
              ]}
              className="w-[120px]"
              triggerClassName="px-2 py-1.5 rounded-lg text-xs text-white/80"
            />
            {logFilter.nodeFilter && (
              <button
                onClick={() => setLogFilter({ nodeFilter: null })}
                className="px-1.5 py-1 rounded text-[10px] bg-white/10 text-white/70
                           hover:bg-white/20 hover:text-white transition-colors"
                title={t('logs.clearNodeFilter')}
              >
                {t('logs.clear')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 日志列表（按节点分段） */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2"
      >
        {/* 顶部懒加载指示 */}
        {loadingOlder && (
          <div className="text-center py-2 text-white/40 text-xs">{t('logs.loadingOlder')}</div>
        )}
        {!loadingOlder && hasMore && (
          <button
            onClick={() => {
              const el = scrollRef.current
              if (el) {
                prependPendingRef.current = true
                prevDistFromBottomRef.current = el.scrollHeight - el.scrollTop
              }
              loadOlderLogs()
            }}
            className="w-full text-center py-1.5 mb-1 text-[11px] text-indigo-300/70
                       hover:text-indigo-300 hover:bg-white/5 rounded-lg transition-colors"
          >
            {t('logs.loadOlder', { count: logsTotal - executionLog.length })}
          </button>
        )}

        {loadingLogs ? (
          <div className="text-center py-8 text-white/30 text-xs">{t('common.loading')}</div>
        ) : segments.length === 0 ? (
          <div className="text-center py-8 text-white/30 text-xs">{t('logs.empty')}</div>
        ) : (
          segments.map((seg) => (
            <NodeLogSegment
              key={seg.key}
              segment={seg}
              searchQuery={logFilter.searchQuery}
            />
          ))
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/10 text-[10px] text-white/40">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLogFilter({ autoScroll: !logFilter.autoScroll })}
            className={`flex items-center gap-1 transition-colors ${
              logFilter.autoScroll ? 'text-white/60' : 'hover:text-white/60'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                logFilter.autoScroll ? 'bg-emerald-400' : 'bg-white/20'
              }`}
            />
            {logFilter.autoScroll ? t('logs.autoScroll') : t('logs.manualScroll')}
          </button>
        </div>
        <span>
          {t('logs.loadedCount', { loaded: executionLog.length, total: logsTotal })}
        </span>
      </div>
    </div>
  )
}

// 单个节点的日志分段：节点名作为段标题，下面的文本均为该节点的日志
function NodeLogSegment({
  segment,
  searchQuery,
}: {
  segment: LogSegment
  searchQuery: string
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-3 first:mt-0">
      {/* 节点标题 */}
      <div className="flex items-center gap-2 px-1 mb-1">
        <span className="w-1 h-3.5 rounded-full bg-indigo-400/70 shrink-0" />
        <span className="text-xs font-medium text-indigo-300 font-mono">
          {segment.nodeName}
        </span>
        <span className="text-[10px] text-white/30">{t('logs.lineCount', { count: segment.logs.length })}</span>
        <div className="flex-1 h-px bg-white/5" />
      </div>

      {/* 该节点的日志行 */}
      <div className="ml-1 pl-2 border-l border-white/5 space-y-0.5">
        {segment.logs.map((log) => (
          <LogLine key={log.id} log={log} searchQuery={searchQuery} />
        ))}
      </div>
    </div>
  )
}

// 单行日志：级别与时间小 label 置于行首，消息内容完整展示不截断
function LogLine({
  log,
  searchQuery,
}: {
  log: ExecutionLog
  searchQuery: string
}) {
  const isError = log.level === 'ERROR' || log.level === 'FATAL'
  const hasDistinctOutput = !!log.output && log.output !== log.message
  const { t } = useTranslation()

  const highlightedMessage = useMemo(() => {
    if (!searchQuery) return log.message
    const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi')
    return log.message.split(regex).map((part, i) =>
      regex.test(part) ? (
        <mark
          key={i}
          className="bg-yellow-400/30 text-white rounded px-0.5"
        >
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    )
  }, [log.message, searchQuery])

  return (
    <div
      className={`py-1 px-1.5 rounded
        ${isError ? 'bg-rose-400/5' : 'hover:bg-white/5'}`}
    >
      <div className="flex items-start gap-1.5">
        {/* 级别 label */}
        <span
          className={`px-1.5 py-px rounded text-[10px] font-medium border shrink-0 ${levelColors[log.level]}`}
        >
          {log.level}
        </span>

        {/* 时间 label */}
        <span className="text-white/40 font-mono text-[10px] shrink-0 pt-px">
          {formatTime(log.timestamp)}
        </span>

        {/* 步骤名 label（可选） */}
        {log.stepName && (
          <span className="px-1.5 py-px rounded bg-white/5 border border-white/10
                           text-white/50 text-[10px] shrink-0">
            {log.stepName}
          </span>
        )}

        {/* 消息内容：完整显示，自动换行 */}
        <span className="flex-1 min-w-0 text-xs leading-relaxed text-white/85
                         whitespace-pre-wrap break-all">
          {highlightedMessage}
        </span>
      </div>

      {/* 输出与消息不同时可展开查看 */}
      {hasDistinctOutput && (
        <details className="mt-1 ml-1">
          <summary className="text-[10px] text-white/40 cursor-pointer hover:text-white/60 select-none">
            {t('logs.outputContent')}
          </summary>
          <pre className="mt-1 p-2 rounded bg-black/30 text-[11px] leading-relaxed
                          text-white/70 whitespace-pre-wrap break-all">
            {log.output}
          </pre>
        </details>
      )}
    </div>
  )
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${h}:${m}:${s}.${ms}`
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
