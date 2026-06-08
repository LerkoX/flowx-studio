import { apiClient } from './api'
import type { ApiResponse } from '@/types/api'
import type { ChatMessage } from '@/types/ai'

/**
 * AI 对话（SSE 流式）
 * POST /api/v1/ai/chat
 */
export async function chatStream(
  sessionId: string,
  message: string,
  onChunk: (chunk: { role: string; content: string }) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  context?: {
    current_page?: string
    selected_node_id?: number
    selected_workflow_id?: number
  }
): Promise<void> {
  const response = await fetch('/api/v1/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      context,
    }),
  })

  if (!response.ok) {
    onError(new Error('Failed to start chat stream'))
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    onError(new Error('No response body'))
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.role && data.content) {
              onChunk(data)
            }
          } catch {
            // ignore parse error
          }
        }
      }
    }
  } catch (error) {
    onError(error as Error)
  } finally {
    onDone()
  }
}

/**
 * 获取对话历史
 * GET /api/v1/ai/chat/:session_id/history
 */
export async function getChatHistory(sessionId: string): Promise<ApiResponse<ChatMessage[]>> {
  const response = await apiClient.get(`/api/v1/ai/chat/${sessionId}/history`)
  return response.data
}

/**
 * AI 生成节点（SSE 流式）
 * POST /api/v1/ai/generate-node
 */
export async function generateNodeStream(
  description: string,
  onChunk: (chunk: { stage: string; message: string }) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  language?: string,
  preferredName?: string
): Promise<void> {
  const response = await fetch('/api/v1/ai/generate-node', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description,
      language,
      preferred_name: preferredName,
    }),
  })

  if (!response.ok) {
    onError(new Error('Failed to start generate node stream'))
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    onError(new Error('No response body'))
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.stage && data.message) {
              onChunk(data)
            }
          } catch {
            // ignore parse error
          }
        }
      }
    }
  } catch (error) {
    onError(error as Error)
  } finally {
    onDone()
  }
}

/**
 * AI 生成工作流（SSE 流式）
 * POST /api/v1/ai/generate-workflow
 */
export async function generateWorkflowStream(
  description: string,
  onChunk: (chunk: { message: string }) => void,
  onDone: () => void,
  onError: (error: Error) => void
): Promise<void> {
  const response = await fetch('/api/v1/ai/generate-workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })

  if (!response.ok) {
    onError(new Error('Failed to start generate workflow stream'))
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    onError(new Error('No response body'))
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.message) {
              onChunk(data)
            }
          } catch {
            // ignore parse error
          }
        }
      }
    }
  } catch (error) {
    onError(error as Error)
  } finally {
    onDone()
  }
}
