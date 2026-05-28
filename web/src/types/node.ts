export interface NodeParameter {
  name: string
  type: string
  description: string
  required: boolean
  default?: unknown
}

export interface NodeDefinition {
  id: string
  name: string
  description?: string
  language?: string
  icon?: string
  parameters: NodeParameter[]
  mockResult?: unknown
  code?: string
}
