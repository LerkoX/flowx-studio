import { useEffect, useRef } from 'react'

export type EventHandler = (type: string, data: unknown) => void

// 后端 SSE 发送的是命名事件（event: <type>），EventSource 的 onmessage
// 只能收到无名字段的消息，命名事件必须逐个 addEventListener 注册
const KNOWN_EVENTS = [
  'execution.started',
  'execution.completed',
  'execution.updated',
  'execution.log',
  'execution_start',
  'execution_complete',
  'execution_paused',
  'execution_resumed',
  'node_start',
  'node_complete',
  'node_preview',
  'workflow.created',
  'workflow.updated',
  'workflow.deleted',
  'node.created',
  'node.updated',
  'node.deleted',
]

// 后端 event.Event 未定义 json tag，序列化结果为 {"Type":..., "Data":...}，
// 这里同时兼容小写键与裸数据（per-execution stream 端点直接序列化 Data）
function parseEventPayload(event: MessageEvent): { type: string; data: unknown } {
  try {
    const payload = JSON.parse(event.data)
    const type = payload?.Type ?? payload?.type ?? event.type
    const data = payload?.Data ?? payload?.data ?? payload
    return { type, data }
  } catch {
    return { type: event.type, data: event.data }
  }
}

// onReconnect：SSE 断线后由浏览器自动重连成功时回调（首次连接不触发）。
// 断线期间错过的事件不会补发，调用方应借此主动重拉关注的数据（如当前工作流
// 定义），否则页面会一直持有旧状态（曾导致陈旧页整量 PUT 覆盖他端新修改）。
export function useEventStream(url: string, onEvent: EventHandler, onReconnect?: () => void) {
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent
  const reconnectRef = useRef(onReconnect)
  reconnectRef.current = onReconnect

  useEffect(() => {
    const es = new EventSource(url)
    let hadError = false

    const handle = (event: MessageEvent) => {
      const { type, data } = parseEventPayload(event)
      handlerRef.current(type, data)
    }

    es.onmessage = handle
    KNOWN_EVENTS.forEach((t) => es.addEventListener(t, handle as EventListener))

    es.onopen = () => {
      if (hadError) {
        hadError = false
        reconnectRef.current?.()
      }
    }
    es.onerror = () => {
      // 自动重连由浏览器 EventSource 处理；标记断线以便重连后补一次重同步
      hadError = true
    }

    return () => es.close()
  }, [url])
}

export class EventBusClient {
  private es: EventSource | null = null
  private handlers = new Set<EventHandler>()

  constructor(private url: string) {}

  connect() {
    if (this.es) return
    this.es = new EventSource(this.url)
    const handle = (event: MessageEvent) => {
      const { type, data } = parseEventPayload(event)
      this.handlers.forEach((h) => h(type, data))
    }
    this.es.onmessage = handle
    KNOWN_EVENTS.forEach((t) => this.es!.addEventListener(t, handle as EventListener))
  }

  disconnect() {
    this.es?.close()
    this.es = null
  }

  subscribe(handler: EventHandler) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
}

export const eventBus = new EventBusClient('/api/v1/events')
