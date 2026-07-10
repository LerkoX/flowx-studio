import { useEffect, useRef } from 'react'

export type EventHandler = (type: string, data: unknown) => void

export function useEventStream(url: string, onEvent: EventHandler) {
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    const es = new EventSource(url)

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        handlerRef.current(payload.type || event.type, payload.data ?? payload)
      } catch {
        handlerRef.current(event.type, event.data)
      }
    }

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
    this.es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        this.handlers.forEach((h) => h(payload.type || event.type, payload.data ?? payload))
      } catch {
        this.handlers.forEach((h) => h(event.type, event.data))
      }
    }
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
