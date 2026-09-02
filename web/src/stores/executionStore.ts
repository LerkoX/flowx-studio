import { create } from 'zustand'
import { getExecutions, getExecution, getExecutionYaml, getExecutionNodes, getExecutionLogs } from '@/services/workflowService'
import type { ExecutionStatus, ExecutionNode, ExecutionLog } from '@/types/execution'

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'FATAL'

interface LogFilter {
  levels: LogLevel[]
  searchQuery: string
  nodeFilter: string | null
  autoScroll: boolean
}

interface ExecutionState {
  isExecuting: boolean
  runningExecutionId: string | null
  executions: ExecutionStatus[]
  selectedExecutionId: string | null
  selectedExecution: ExecutionStatus | null
  // 选中执行的运行时快照 YAML（该执行的独立图定义，与流水线模板解耦）；
  // null 表示无快照或未加载，画布回退用模板渲染
  selectedExecutionYaml: string | null
  executionNodes: ExecutionNode[]
  executionLog: ExecutionLog[]
  logsTotal: number
  loadingHistory: boolean
  loadingNodes: boolean
  loadingLogs: boolean
  loadingOlder: boolean
  loadingSelected: boolean
  logFilter: LogFilter

  loadExecutions: (workflowId: string) => Promise<void>
  selectExecution: (id: string | null) => Promise<void>
  loadExecutionNodes: (executionId: string) => Promise<void>
  loadLatestLogs: (executionId: string) => Promise<void>
  loadOlderLogs: () => Promise<void>
  startExecution: (id: string) => void
  stopExecution: () => void
  // 续跑选中执行：仅标记运行中（保留已执行节点状态与历史日志，增量追加）
  beginContinue: (id: string) => void
  updateExecutionStatus: (executionId: string, status: ExecutionStatus['status']) => void
  updateExecutionMetadata: (executionId: string, metadata: Record<string, unknown>) => void
  setExecutionNodes: (nodes: ExecutionNode[]) => void
  appendRealtimeLog: (entry: ExecutionLog) => void
  setLogFilter: (filter: Partial<LogFilter>) => void
  clearLogs: () => void
  exportLogs: (format: 'json' | 'txt' | 'markdown') => string
}

// 日志分页大小：初始加载最后 300 条，向上滚动时按 300 条一页懒加载更旧的日志
const LOG_PAGE_SIZE = 300

// 过滤条件变化时防抖重载日志
let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  isExecuting: false,
  runningExecutionId: null,
  executions: [],
  selectedExecutionId: null,
  selectedExecution: null,
  selectedExecutionYaml: null,
  executionNodes: [],
  executionLog: [],
  logsTotal: 0,
  loadingHistory: false,
  loadingNodes: false,
  loadingLogs: false,
  loadingOlder: false,
  loadingSelected: false,
  logFilter: {
    levels: ['INFO', 'WARN', 'ERROR', 'DEBUG'],
    searchQuery: '',
    nodeFilter: null,
    autoScroll: true,
  },

  loadExecutions: async (workflowId) => {
    set({ loadingHistory: true })
    try {
      const resp = await getExecutions({ workflow_id: Number(workflowId), page_size: 50 })
      if (resp.code === 200 && resp.data) {
        const executions = (resp.data.items || []).map(normalizeExecution)
        const selectedId = get().selectedExecutionId
        const selectedExecution = selectedId
          ? executions.find((e) => e.id === selectedId) || get().selectedExecution
          : get().selectedExecution
        set({ executions, selectedExecution, loadingHistory: false })
      }
    } catch (error) {
      set({ loadingHistory: false })
      console.error('Failed to load executions', error)
    }
  },

  selectExecution: async (id) => {
    set({ selectedExecutionId: id, selectedExecution: null, selectedExecutionYaml: null, loadingSelected: true })
    if (!id) {
      set({ executionNodes: [], executionLog: [], loadingSelected: false })
      return
    }
    // 正在实时执行的实例：日志由 SSE 逐条推送，此时若从 DB 重载，
    // 异步响应返回时会覆盖已到达的实时日志（竞态），故跳过日志重载
    const isLiveExecution = get().isExecuting && get().runningExecutionId === id
    try {
      const [execResp, yamlResp] = await Promise.all([
        getExecution(id),
        // 快照获取失败（旧执行无快照/网络问题）不阻塞回放，画布回退模板渲染
        getExecutionYaml(id).catch(() => null),
        get().loadExecutionNodes(id),
        isLiveExecution ? Promise.resolve() : get().loadLatestLogs(id),
      ])
      if (execResp.code === 200 && execResp.data) {
        set({ selectedExecution: normalizeExecution(execResp.data) })
      }
      if (yamlResp?.code === 200 && yamlResp.data?.hasSnapshot) {
        set({ selectedExecutionYaml: yamlResp.data.yaml })
      }
    } catch (error) {
      console.error('Failed to select execution', error)
    } finally {
      set({ loadingSelected: false })
    }
  },

  loadExecutionNodes: async (executionId) => {
    set({ loadingNodes: true })
    try {
      const resp = await getExecutionNodes(executionId)
      if (resp.code === 200 && resp.data) {
        set({ executionNodes: resp.data.map(normalizeNode), loadingNodes: false })
      }
    } catch (error) {
      set({ loadingNodes: false })
      console.error('Failed to load execution nodes', error)
    }
  },

  // 加载最后 N 条日志（desc 取回后反转为时间正序展示）
  loadLatestLogs: async (executionId) => {
    set({ loadingLogs: true })
    try {
      const { logFilter } = get()
      const resp = await getExecutionLogs(executionId, {
        node_id: logFilter.nodeFilter || undefined,
        search: logFilter.searchQuery || undefined,
        order: 'desc',
        limit: LOG_PAGE_SIZE,
        offset: 0,
      })
      if (resp.code === 200 && resp.data) {
        const logs = (resp.data.items || []).map(normalizeLog).reverse()
        set({ executionLog: logs, logsTotal: resp.data.total, loadingLogs: false })
      }
    } catch (error) {
      set({ loadingLogs: false })
      console.error('Failed to load latest logs', error)
    }
  },

  // 懒加载更旧的日志：desc 序下 offset = 已加载条数，取回后 prepend 到头部
  loadOlderLogs: async () => {
    const { selectedExecutionId, executionLog, logsTotal, loadingOlder, loadingLogs, logFilter } = get()
    if (!selectedExecutionId || loadingOlder || loadingLogs) return
    if (executionLog.length >= logsTotal) return
    set({ loadingOlder: true })
    try {
      const resp = await getExecutionLogs(selectedExecutionId, {
        node_id: logFilter.nodeFilter || undefined,
        search: logFilter.searchQuery || undefined,
        order: 'desc',
        limit: LOG_PAGE_SIZE,
        offset: executionLog.length,
      })
      if (resp.code === 200 && resp.data) {
        const older = (resp.data.items || []).map(normalizeLog).reverse()
        const existingIds = new Set(executionLog.map((l) => l.id))
        set((state) => ({
          executionLog: [...older.filter((l) => !existingIds.has(l.id)), ...state.executionLog],
          logsTotal: resp.data.total,
          loadingOlder: false,
        }))
      } else {
        set({ loadingOlder: false })
      }
    } catch (error) {
      set({ loadingOlder: false })
      console.error('Failed to load older logs', error)
    }
  },

  startExecution: (id) =>
    set({
      isExecuting: true,
      runningExecutionId: id,
      selectedExecutionId: id,
      executionLog: [],
      logsTotal: 0,
      executionNodes: [],
    }),

  stopExecution: () => set({ isExecuting: false, runningExecutionId: null }),

  beginContinue: (id) => set({ isExecuting: true, runningExecutionId: id }),

  updateExecutionStatus: (executionId, status) => {
    set((state) => {
      const executions = state.executions.map((e) =>
        e.id === executionId ? { ...e, status } : e
      )
      const selectedExecution =
        state.selectedExecution?.id === executionId
          ? { ...state.selectedExecution, status }
          : state.selectedExecution
      return { executions, selectedExecution }
    })
  },

  updateExecutionMetadata: (executionId, metadata) => {
    set((state) => {
      const executions = state.executions.map((e) =>
        e.id === executionId
          ? { ...e, metadata: { ...(e.metadata || {}), ...metadata } }
          : e
      )
      const selectedExecution =
        state.selectedExecution?.id === executionId
          ? {
              ...state.selectedExecution,
              metadata: {
                ...(state.selectedExecution.metadata || {}),
                ...metadata,
              },
            }
          : state.selectedExecution
      return { executions, selectedExecution }
    })
  },

  setExecutionNodes: (nodes) => set({ executionNodes: nodes }),

  appendRealtimeLog: (entry) =>
    set((state) => ({
      executionLog: [...state.executionLog, normalizeLog(entry)],
      logsTotal: state.logsTotal + 1,
    })),

  setLogFilter: (filter) => {
    const prev = get().logFilter
    set((state) => ({
      logFilter: { ...state.logFilter, ...filter },
    }))
    // 节点过滤与搜索改为服务端过滤（分页懒加载下客户端过滤会漏未加载的旧日志），
    // 条件变化时防抖重载最后一页日志。实时执行期间不重载，避免覆盖 SSE 推送的日志。
    const serverFilterChanged =
      (filter.nodeFilter !== undefined && filter.nodeFilter !== prev.nodeFilter) ||
      (filter.searchQuery !== undefined && filter.searchQuery !== prev.searchQuery)
    if (!serverFilterChanged) return
    const { selectedExecutionId, isExecuting, runningExecutionId } = get()
    if (!selectedExecutionId) return
    if (isExecuting && runningExecutionId === selectedExecutionId) return
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
    filterDebounceTimer = setTimeout(() => {
      get().loadLatestLogs(selectedExecutionId)
    }, 300)
  },

  clearLogs: () => set({ executionLog: [], logsTotal: 0 }),

  exportLogs: (format) => {
    const { executionLog } = get()
    switch (format) {
      case 'json':
        return JSON.stringify(executionLog, null, 2)
      case 'txt':
        return executionLog
          .map(
            (log) =>
              `${formatTime(log.timestamp)} ${log.level.toUpperCase()} [${log.nodeName}] ${log.message}`
          )
          .join('\n')
      case 'markdown':
        return executionLog
          .map(
            (log) =>
              `- **${formatTime(log.timestamp)}** \`${log.level.toUpperCase()}\` **[${log.nodeName}]** ${log.message}`
          )
          .join('\n')
    }
  },
}))

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined
  // 后端 metadata_json 列以 JSON 字符串返回，需解析
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function normalizeExecution(item: unknown): ExecutionStatus {
  const e = item as Record<string, unknown>
  return {
    id: String(e.id),
    workflowId: String(e.workflow_id ?? e.workflowId ?? ''),
    status: String(e.status || 'pending') as ExecutionStatus['status'],
    trigger: String(e.trigger || 'manual'),
    startedAt: parseDate(e.started_at ?? e.startedAt),
    completedAt: parseDate(e.completed_at ?? e.completedAt),
    durationMs: Number(e.duration_ms ?? e.durationMs ?? 0),
    result: e.result ? String(e.result) : undefined,
    errorMessage: e.error_message ? String(e.error_message) : undefined,
    errorNodeId: e.error_node_id ? String(e.error_node_id) : undefined,
    metadata: normalizeMetadata(e.metadata),
    createdAt: parseDate(e.created_at ?? e.createdAt) || new Date(),
  }
}

function normalizeNode(item: unknown): ExecutionNode {
  const n = item as Record<string, unknown>
  return {
    id: String(n.id),
    executionId: String(n.execution_id ?? n.executionId ?? ''),
    nodeId: String(n.node_id ?? n.nodeId ?? ''),
    nodeName: String(n.node_name ?? n.nodeName ?? n.node_id ?? ''),
    status: String(n.status || 'pending') as ExecutionNode['status'],
    startedAt: parseDate(n.started_at ?? n.startedAt),
    completedAt: parseDate(n.completed_at ?? n.completedAt),
    durationMs: Number(n.duration_ms ?? n.durationMs ?? 0),
    output: n.output ? String(n.output) : undefined,
    error: n.error ? String(n.error) : undefined,
  }
}

function normalizeLog(item: unknown): ExecutionLog {
  const l = item as Record<string, unknown>
  return {
    id: String(l.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    executionId: Number(l.execution_id ?? l.executionId ?? 0),
    nodeId: l.node_id ? String(l.node_id) : undefined,
    nodeName: String(l.node_name ?? l.nodeName ?? l.node_id ?? 'system'),
    stepName: l.step_name ? String(l.step_name) : undefined,
    level: String(l.level || 'info').toUpperCase() as ExecutionLog['level'],
    message: String(l.message ?? ''),
    output: l.output ? String(l.output) : undefined,
    timestamp: parseDate(l.timestamp) || new Date(),
  }
}

function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined
  const d = new Date(value as string | number)
  return isNaN(d.getTime()) ? undefined : d
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${h}:${m}:${s}.${ms}`
}
