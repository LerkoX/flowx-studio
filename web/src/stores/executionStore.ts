import { create } from 'zustand'
import { getExecutions, getExecution, getExecutionNodes, getExecutionLogs } from '@/services/workflowService'
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
  executions: ExecutionStatus[]
  selectedExecutionId: string | null
  selectedExecution: ExecutionStatus | null
  executionNodes: ExecutionNode[]
  executionLog: ExecutionLog[]
  loadingHistory: boolean
  loadingNodes: boolean
  loadingLogs: boolean
  loadingSelected: boolean
  logFilter: LogFilter

  loadExecutions: (workflowId: string) => Promise<void>
  selectExecution: (id: string | null) => Promise<void>
  loadExecutionNodes: (executionId: string) => Promise<void>
  loadExecutionLogs: (executionId: string, nodeId?: string | null) => Promise<void>
  startExecution: (id: string) => void
  stopExecution: () => void
  updateExecutionStatus: (executionId: string, status: ExecutionStatus['status']) => void
  updateExecutionMetadata: (executionId: string, metadata: Record<string, unknown>) => void
  setExecutionNodes: (nodes: ExecutionNode[]) => void
  appendRealtimeLog: (entry: ExecutionLog) => void
  setLogFilter: (filter: Partial<LogFilter>) => void
  clearLogs: () => void
  exportLogs: (format: 'json' | 'txt' | 'markdown') => string
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  isExecuting: false,
  executions: [],
  selectedExecutionId: null,
  selectedExecution: null,
  executionNodes: [],
  executionLog: [],
  loadingHistory: false,
  loadingNodes: false,
  loadingLogs: false,
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
    set({ selectedExecutionId: id, selectedExecution: null, loadingSelected: true })
    if (!id) {
      set({ executionNodes: [], executionLog: [], loadingSelected: false })
      return
    }
    try {
      const [execResp] = await Promise.all([
        getExecution(id),
        get().loadExecutionNodes(id),
        get().loadExecutionLogs(id),
      ])
      if (execResp.code === 200 && execResp.data) {
        set({ selectedExecution: normalizeExecution(execResp.data) })
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

  loadExecutionLogs: async (executionId, nodeId = null) => {
    set({ loadingLogs: true })
    try {
      const resp = await getExecutionLogs(executionId, {
        node_id: nodeId || undefined,
        limit: 200,
        offset: 0,
      })
      if (resp.code === 200 && resp.data) {
        const logs = (resp.data.items || []).map(normalizeLog)
        set({ executionLog: logs, loadingLogs: false })
      }
    } catch (error) {
      set({ loadingLogs: false })
      console.error('Failed to load execution logs', error)
    }
  },

  startExecution: (id) =>
    set({
      isExecuting: true,
      selectedExecutionId: id,
      executionLog: [],
      executionNodes: [],
    }),

  stopExecution: () => set({ isExecuting: false }),

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
    })),

  setLogFilter: (filter) =>
    set((state) => ({
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
