import { useEffect, useRef } from 'react'
import type { JobStatusEvent } from '@/types/api'
import { renewAccessToken } from '@/lib/api-client'
import { getAccessToken } from '@/lib/access-token'

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8085'

// notification-service 關閉連線的代碼（見 notification-service/app/controllers/ws_controller.py）。
export const CLOSE_UNAUTHORIZED = 4401
export const CLOSE_JOB_NOT_FOUND = 4404
export const CLOSE_TOO_MANY_CONNECTIONS = 4429

export const RECONNECT_DELAY_MS = 3000
export const TOO_MANY_CONNECTIONS_DELAY_MS = 30_000

type SocketMessage = JobStatusEvent | { type: 'subscribed'; jobId: string }

// 連上之後第一則訊息送 access token（瀏覽器的 WebSocket 不能帶 Authorization 標頭，token 也不放網址）；
// notification-service 確認 Job 是這位使用者的才會開始推播。
export function useJobSocket(jobId: string | undefined, onEvent: (event: JobStatusEvent) => void) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!jobId) return

    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let closedByCleanup = false
    // 換發過 token 還是被拒絕，就不再試（例如密鑰設定不一致），免得一直換發。
    let renewedSinceSubscribed = false

    const reconnectIn = (delayMs: number) => {
      if (!closedByCleanup) reconnectTimer = setTimeout(connect, delayMs)
    }

    const connect = () => {
      const accessToken = getAccessToken()
      if (!accessToken) return
      socket = new WebSocket(`${WS_BASE_URL}/ws/jobs/${jobId}`)
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'auth', accessToken }))
      }
      socket.onmessage = (msg) => {
        let data: SocketMessage
        try {
          data = JSON.parse(msg.data) as SocketMessage
        } catch {
          return // ignore malformed frames
        }
        if ('type' in data) {
          renewedSinceSubscribed = false
          return
        }
        onEventRef.current(data)
      }
      socket.onclose = (event) => {
        if (closedByCleanup) return
        switch (event.code) {
          case CLOSE_JOB_NOT_FOUND:
            return
          case CLOSE_TOO_MANY_CONNECTIONS:
            reconnectIn(TOO_MANY_CONNECTIONS_DELAY_MS)
            return
          case CLOSE_UNAUTHORIZED:
            if (renewedSinceSubscribed) return
            renewedSinceSubscribed = true
            void renewAccessToken().then((renewed) => {
              if (renewed) reconnectIn(0)
            })
            return
          default:
            reconnectIn(RECONNECT_DELAY_MS)
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
