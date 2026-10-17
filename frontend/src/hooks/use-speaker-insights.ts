import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { speakerInsightsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import type { SpeakerInsights } from '@/types/api'

const POLL_INTERVAL_MS = 3000

export interface SpeakerInsightsActions {
  /** Null until loaded (or when it couldn't be). */
  insights: SpeakerInsights | null
  isRequesting: boolean
  request: () => void
}

// 講者數據的 AI 判斷 (questions and possible interruptions): analysed in the background; while GENERATING it's asked for
// again every 3 seconds, and once it settles onSettled is told (the analysis used the model, so the usage has grown).
// Lives in the page, not the Studio card, so polling carries on while the phone's Studio sheet is closed (as quizzes).
export function useSpeakerInsights(jobId: string | undefined, isCompleted: boolean, onSettled: () => void): SpeakerInsightsActions {
  const [insights, setInsights] = useState<SpeakerInsights | null>(null)
  const [isRequesting, setIsRequesting] = useState(false)

  useEffect(() => {
    if (!jobId || !isCompleted) return
    let cancelled = false
    speakerInsightsApi
      .get(jobId)
      .then((latest) => {
        if (!cancelled) setInsights(latest)
      })
      .catch(() => {}) // the card just offers to analyse
    return () => {
      cancelled = true
    }
  }, [jobId, isCompleted])

  const generating = insights?.status === 'GENERATING'
  useEffect(() => {
    if (!jobId || !generating) return
    const timer = setInterval(() => {
      speakerInsightsApi
        .get(jobId)
        .then((latest) => {
          setInsights(latest)
          if (latest.status !== 'GENERATING') onSettled()
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [jobId, generating, onSettled])

  const request = useCallback(() => {
    if (!jobId || isRequesting) return
    setIsRequesting(true)
    speakerInsightsApi
      .request(jobId)
      .then(setInsights)
      .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法開始分析，請稍後再試'))
      .finally(() => setIsRequesting(false))
  }, [jobId, isRequesting])

  return { insights, isRequesting, request }
}
