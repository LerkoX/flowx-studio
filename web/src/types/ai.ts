export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  actions?: AIAction[]
}

export interface AIAction {
  id: string
  type: 'run' | 'pause' | 'retry' | 'export' | 'create_node' | 'create_workflow'
  label: string
  payload?: Record<string, unknown>
}
