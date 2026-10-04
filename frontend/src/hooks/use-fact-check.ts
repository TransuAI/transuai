import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { factCheckApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import type { JobFactCheck } from '@/types/api'

const POLL_INTERVAL_MS = 3000

export interface FactCheckActions {
  /** Null until loaded (or when it couldn't be). */
  factCheck: JobFactCheck | null
  isRequesting: boolean
  find: () => void
}

// 事實查核: claims found in the background; while that's GENERATING (or a claim is being checked) it's asked for again every
// 3 seconds, and once it settles onSettled is told (the model was used). Lives in the page, not the Studio card, so polling
// carries on while the phone's Studio sheet is closed, and the transcript can mark the claims (as quizzes, decisions).
export function useFactCheck(jobId: string | undefined, isCompleted: boolean, onSettled: () => void): FactCheckActions {
  const [factCheck, setFactCheck] = useState<JobFactCheck | null>(null)
  const [isRequesting, setIsRequesting] = useState(false)
  // Bumped on every change made here: a list asked for before it is out of date, so its answer is dropped (as use-decisions).
  const localChanges = useRef(0)
  const load = useCallback((id: string) => {
    const asOf = localChanges.current
    return factCheckApi.get(id).then((latest) => (asOf === localChanges.current ? latest : null))
  }, [])

  useEffect(() => {
    if (!jobId || !isCompleted) return
    let cancelled = false
    load(jobId)
      .then((latest) => {
        if (!cancelled && latest) setFactCheck(latest)
      })
      .catch(() => {}) // the card just offers to find them
    return () => {
      cancelled = true
    }
  }, [jobId, isCompleted, load])

  const busy =
    factCheck?.extraction?.status === 'GENERATING' || (factCheck?.claims.some((claim) => claim.checking) ?? false)
  useEffect(() => {
    if (!jobId || !busy) return
    const timer = setInterval(() => {
      load(jobId)
        .then((latest) => {
          if (!latest) return
          setFactCheck(latest)
          if (latest.extraction?.status !== 'GENERATING' && !latest.claims.some((claim) => claim.checking)) onSettled()
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [jobId, busy, onSettled, load])

  const find = useCallback(() => {
    if (!jobId || isRequesting) return
    setIsRequesting(true)
    factCheckApi
      .find(jobId)
      .then((extraction) => {
        localChanges.current += 1
        setFactCheck((prev) => ({ extraction, claims: prev?.claims ?? [] }))
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法開始找主張，請稍後再試'))
      .finally(() => setIsRequesting(false))
  }, [jobId, isRequesting])

  return { factCheck, isRequesting, find }
}
