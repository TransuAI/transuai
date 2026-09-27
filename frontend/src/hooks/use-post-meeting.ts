import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { postMeetingApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import type { PostMeeting } from '@/types/api'

const POLL_INTERVAL_MS = 3000

// 會後處理 (see ai-service CONTEXT.md): whether the user can run it, and the job's latest run. While a run is going
// its progress is asked for every 3 seconds; once it ends onSettled is told (the run used the model, so the usage
// has grown). Lives in the page, not the Studio card, so polling carries on while the phone's Studio sheet is closed.
export function usePostMeeting(jobId: string | undefined, isCompleted: boolean, onSettled: () => void) {
  const [postMeeting, setPostMeeting] = useState<PostMeeting | null>(null)
  // Between the click and the server's answer: one click is one request.
  const [isStarting, setIsStarting] = useState(false)
  // Every request takes a number; only the latest one's answer is used, so a slow poll can't bring back an older
  // state, and nothing from another job lands here after the page moves on.
  const latestRequest = useRef(0)

  const ask = useCallback((request: () => Promise<PostMeeting>) => {
    const number = ++latestRequest.current
    return request().then((answer) => (number === latestRequest.current ? answer : null))
  }, [])

  useEffect(() => {
    if (!jobId || !isCompleted) return
    ask(() => postMeetingApi.get(jobId))
      .then((loaded) => {
        if (loaded) setPostMeeting(loaded)
      })
      .catch(() => {}) // the card just shows nothing yet
    return () => {
      latestRequest.current += 1
    }
  }, [jobId, isCompleted, ask])

  const runningId = postMeeting?.latestRun?.status === 'RUNNING' ? postMeeting.latestRun.id : null

  useEffect(() => {
    if (!jobId || !runningId) return
    const timer = setInterval(() => {
      ask(() => postMeetingApi.get(jobId))
        .then((latest) => {
          if (!latest) return
          setPostMeeting(latest)
          if (latest.latestRun?.id !== runningId || latest.latestRun.status !== 'RUNNING') onSettled()
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [jobId, runningId, onSettled, ask])

  const start = useCallback(() => {
    if (!jobId || isStarting) return
    setIsStarting(true)
    ask(() => postMeetingApi.start(jobId, Intl.DateTimeFormat().resolvedOptions().timeZone))
      .then((started) => {
        if (started) setPostMeeting(started)
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法開始會後處理'))
      .finally(() => setIsStarting(false))
  }, [jobId, isStarting, ask])

  return { postMeeting, start, isStarting }
}
