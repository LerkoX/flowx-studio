export interface ExecutionStatus {
  id: string
  workflowId: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  startTime?: Date
  endTime?: Date
  nodeStatuses: Record<string, string>
  logs: string[]
}
