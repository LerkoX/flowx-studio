import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useExecutionStore, type LogLevel } from '@/stores/executionStore'

const levelColors: Record<LogLevel, string> = {
  INFO: 'bg-emerald-400/20 text-emerald-400 border-emerald-400/30',
  WARN: 'bg-amber-400/20 text-amber-400 border-amber-400/30',
  ERROR: 'bg-rose-400/20 text-rose-400 border-rose-400/30',
  DEBUG: 'bg-slate-400/20 text-slate-400 border-slate-400/30',
}

const levelShortColors: Record<LogLevel, string> = {
  INFO: 'text-emerald-400',
  WARN: 'text-amber-400',
  ERROR: 'text-rose-400',
  DEBUG: 'text-slate-400',
}

export default function LogViewer() {
  const { executionLog, logFilter, setLogFilter } = useExecutionStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)

  const filteredLogs = useMemo(() => {
    return executionLog.filter((log) => {
      if (!logFilter.levels.includes(log.level)) return false
      if (logFilter.nodeFilter && log.nodeName !== logFilter.nodeFilter) return false
      if (logFilter.searchQuery) {
        const query = logFilter.searchQuery.toLowerCase()
        return (
          log.message.toLowerCase().includes(query) ||
          log.nodeName.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [executionLog, logFilter])

  // 自动滚动到底部
  useEffect(() => {
    if (logFilter.autoScroll && !userScrolled && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filteredLogs, logFilter.autoScroll, userScrolled])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50
    setUserScrolled(!isNearBottom)
  }, [])

  const uniqueNodes = useMemo(() => {
    const nodes = new Set(executionLog.map((log) => log.nodeName))
    return Array.from(nodes)
  }, [executionLog])

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        {/* 搜索框 */}
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
            placeholder="搜索日志..."
            value={logFilter.searchQuery}
            onChange={(e) => setLogFilter({ searchQuery: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-2 py-1.5
                       text-xs text-white/80 placeholder:text-white/30
                       focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>

        {/* 级别过滤 */}
        <div className="flex gap-1">
          {(['INFO', 'WARN', 'ERROR', 'DEBUG'] as LogLevel[]).map((level) => (
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

        {/* 节点过滤 */}
        {uniqueNodes.length > 0 && (
          <select
            value={logFilter.nodeFilter || ''}
            onChange={(e) =>
              setLogFilter({ nodeFilter: e.target.value || null })
            }
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5
                       text-xs text-white/80 focus:outline-none focus:border-white/30
                       cursor-pointer"
          >
            <option value="" className="bg-[#1a1f3a]">全部节点</option>
            {uniqueNodes.map((node) => (
              <option key={node} value={node} className="bg-[#1a1f3a]">
                {node}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 日志列表 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1"
      >
        <AnimatePresence initial={false}>
          {filteredLogs.map((log) => (
            <LogEntryRow
              key={log.id}
              log={log}
              searchQuery={logFilter.searchQuery}
            />
          ))}
        </AnimatePresence>

        {filteredLogs.length === 0 && (
          <div className="text-center py-8 text-white/30 text-xs">
            暂无日志
          </div>
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
            {logFilter.autoScroll ? '自动滚动' : '手动滚动'}
          </button>
        </div>
        <span>共 {filteredLogs.length} 条日志</span>
      </div>
    </div>
  )
}

function LogEntryRow({
  log,
  searchQuery,
}: {
  log: {
    id: string
    timestamp: Date
    level: LogLevel
    nodeName: string
    message: string
  }
  searchQuery: string
}) {
  const isError = log.level === 'ERROR'
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
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.1 }}
      className={`group flex gap-2 py-1 px-2 rounded-lg text-xs leading-relaxed
        ${isError ? 'border-l-2 border-l-rose-400 bg-rose-400/5' : 'hover:bg-white/5'}`}
    >
      {/* 时间戳 */}
      <span className="text-white/40 font-mono text-[10px] shrink-0 pt-0.5 w-[72px]">
        {formatTime(log.timestamp)}
      </span>

      {/* 级别标签 */}
      <span
        className={`text-[10px] font-medium shrink-0 w-10 pt-0.5 ${levelShortColors[log.level]}`}
      >
        {log.level}
      </span>

      {/* 节点名 */}
      <span className="text-indigo-400 font-mono text-[10px] shrink-0 pt-0.5 w-16 truncate">
        [{log.nodeName}]
      </span>

      {/* 消息内容 */}
      <span className="text-white/80 break-all">{highlightedMessage}</span>
    </motion.div>
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
