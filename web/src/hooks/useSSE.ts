import { useState, useEffect, useRef, useCallback } from 'react'

export function useSSE(url: string) {
  const [data, setData] = useState<string>('')
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onopen = () => {
      setIsConnected(true)
      setError(null)
    }

    es.onmessage = (event) => {
      setData(event.data)
    }

    es.onerror = (err) => {
      setError(new Error('SSE connection error'))
      setIsConnected(false)
    }
  }, [url])

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close()
    setIsConnected(false)
  }, [])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return { data, isConnected, error, connect, disconnect }
}
