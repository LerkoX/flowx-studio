export interface ExecutionNode {
  id: string
  executionId: string
  nodeId: string
  nodeName: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  startedAt?: Date
  completedAt?: Date
  durationMs?: number
  output?: string
  error?: string
}

export interface ExecutionLog {
  id: string
  executionId: number
  nodeId?: string
  nodeName: string
  stepName?: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'FATAL'
  message: string
  output?: string
  timestamp: Date
}

export interface ExecutionStatus {
  id: string
  workflowId: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  trigger?: string
  startedAt?: Date
  completedAt?: Date
  durationMs?: number
  result?: string
  errorMessage?: string
  errorNodeId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
}
