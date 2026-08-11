import { useEffect, useRef } from 'react'
import type { JobStatusEvent } from '@/types/api'

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8085'

export function useJobSocket(jobId: string | undefined, onEvent: (event: JobStatusEvent) => void) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!jobId) return

    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let closedByCleanup = false

    const connect = () => {
      socket = new WebSocket(`${WS_BASE_URL}/ws/jobs/${jobId}`)
      socket.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as JobStatusEvent
          onEventRef.current(data)
        } catch {
          // ignore malformed frames
        }
      }
      socket.onclose = () => {
        if (!closedByCleanup) {
          reconnectTimer = setTimeout(connect, 3000)
        }
      }
    }

    connect()

    return () => {
      closedByCleanup = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [jobId])
}
