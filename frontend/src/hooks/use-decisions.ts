import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { decisionsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import type { JobDecisions } from '@/types/api'

const POLL_INTERVAL_MS = 3000

export interface DecisionsActions {
  /** Null until loaded (or when they couldn't be). */
  decisions: JobDecisions | null
  isRequesting: boolean
  extract: () => void
}

// 決策紀錄: extracted in the background — asked for here, or by the pipeline once a meeting or interview is transcribed (so
// it can already be GENERATING when the page opens). While GENERATING it's asked for again every 3 seconds, and once it
// settles onSettled is told (the extraction used the model). Lives in the page, not the Studio card, so polling carries
// on while the phone's Studio sheet is closed (as quizzes).
export function useDecisions(jobId: string | undefined, isCompleted: boolean, onSettled: () => void): DecisionsActions {
  const [decisions, setDecisions] = useState<JobDecisions | null>(null)
  const [isRequesting, setIsRequesting] = useState(false)

  useEffect(() => {
    if (!jobId || !isCompleted) return
    let cancelled = false
    decisionsApi
      .list(jobId)
      .then((latest) => {
        if (!cancelled) setDecisions(latest)
      })
      .catch(() => {}) // the card just offers to extract
    return () => {
      cancelled = true
    }
  }, [jobId, isCompleted])

  const generating = decisions?.extraction?.status === 'GENERATING'
  useEffect(() => {
    if (!jobId || !generating) return
    const timer = setInterval(() => {
      decisionsApi
        .list(jobId)
        .then((latest) => {
          setDecisions(latest)
          if (latest.extraction?.status !== 'GENERATING') onSettled()
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [jobId, generating, onSettled])

  const extract = useCallback(() => {
    if (!jobId || isRequesting) return
    setIsRequesting(true)
    decisionsApi
      .extract(jobId)
      .then((extraction) => setDecisions((prev) => ({ extraction, decisions: prev?.decisions ?? [] })))
      .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法開始抽取決策，請稍後再試'))
      .finally(() => setIsRequesting(false))
  }, [jobId, isRequesting])

  return { decisions, isRequesting, extract }
}
