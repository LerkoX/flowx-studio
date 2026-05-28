import { create } from 'zustand'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

export interface LogEntry {
  id: string
  timestamp: Date
  level: LogLevel
  nodeName: string
  message: string
}

interface ExecutionState {
  isExecuting: boolean
  executionLog: LogEntry[]
  currentExecutionId: string | null
  logFilter: {
    levels: LogLevel[]
    searchQuery: string
    nodeFilter: string | null
    autoScroll: boolean
  }

  startExecution: (id: string) => void
  stopExecution: () => void
  appendLog: (entry: LogEntry) => void
  setLogFilter: (filter: Partial<ExecutionState['logFilter']>) => void
  clearLogs: () => void
  exportLogs: (format: 'json' | 'txt' | 'markdown') => string
}

const demoLogs: LogEntry[] = [
  {
    id: 'log_1',
    timestamp: new Date(Date.now() - 5000),
    level: 'INFO',
    nodeName: 'download',
    message: '开始下载图片...',
  },
  {
    id: 'log_2',
    timestamp: new Date(Date.now() - 4000),
    level: 'INFO',
    nodeName: 'download',
    message: '下载完成，2048 bytes',
  },
  {
    id: 'log_3',
    timestamp: new Date(Date.now() - 3000),
    level: 'WARN',
    nodeName: 'compress',
    message: '图片质量降级',
  },
  {
    id: 'log_4',
    timestamp: new Date(Date.now() - 2000),
    level: 'ERROR',
    nodeName: 'upload',
    message: '上传失败：连接超时',
  },
  {
    id: 'log_5',
    timestamp: new Date(Date.now() - 1000),
    level: 'DEBUG',
    nodeName: 'upload',
    message: '重试第 1 次...',
  },
  {
    id: 'log_6',
    timestamp: new Date(),
    level: 'INFO',
    nodeName: 'upload',
    message: '上传成功',
  },
]

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  isExecuting: false,
  executionLog: demoLogs,
  currentExecutionId: null,
  logFilter: {
    levels: ['INFO', 'WARN', 'ERROR', 'DEBUG'],
    searchQuery: '',
    nodeFilter: null,
    autoScroll: true,
  },

  startExecution: (id) => set({
    isExecuting: true,
    currentExecutionId: id,
    executionLog: [],
  }),

  stopExecution: () => set({ isExecuting: false, currentExecutionId: null }),

  appendLog: (entry) => set((state) => ({
    executionLog: [...state.executionLog, entry],
  })),

  setLogFilter: (filter) => set((state) => ({
    logFilter: { ...state.logFilter, ...filter },
  })),

  clearLogs: () => set({ executionLog: [] }),

  exportLogs: (format) => {
    const { executionLog } = get()
    switch (format) {
      case 'json':
        return JSON.stringify(executionLog, null, 2)
      case 'txt':
        return executionLog
          .map((log) => `${formatTime(log.timestamp)} ${log.level} [${log.nodeName}] ${log.message}`)
          .join('\n')
      case 'markdown':
        return executionLog
          .map((log) => `- **${formatTime(log.timestamp)}** \`${log.level}\` **[${log.nodeName}]** ${log.message}`)
          .join('\n')
    }
  },
}))

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${h}:${m}:${s}.${ms}`
}
