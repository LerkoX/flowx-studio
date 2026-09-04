import { useEffect, useRef } from 'react'

export type EventHandler = (type: string, data: unknown) => void

// 后端 SSE 发送的是命名事件（event: <type>），EventSource 的 onmessage
// 只能收到无名字段的消息，命名事件必须逐个 addEventListener 注册
const KNOWN_EVENTS = [
  'execution.started',
  'execution.completed',
  'execution.log',
  'execution_start',
  'execution_complete',
  'execution_paused',
  'execution_resumed',
  'node_start',
  'node_complete',
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

export function useEventStream(url: string, onEvent: EventHandler) {
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    const es = new EventSource(url)

    const handle = (event: MessageEvent) => {
      const { type, data } = parseEventPayload(event)
      handlerRef.current(type, data)
    }

    es.onmessage = handle
    KNOWN_EVENTS.forEach((t) => es.addEventListener(t, handle as EventListener))

    es.onerror = () => {
      // 自动重连由浏览器 EventSource 处理
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
