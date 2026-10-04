import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { decisionsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import type { Decision, DecisionInput, JobDecisions } from '@/types/api'

const POLL_INTERVAL_MS = 3000

export interface DecisionsActions {
  /** Null until loaded (or when they couldn't be). */
  decisions: JobDecisions | null
  isRequesting: boolean
  extract: () => void
  /** These reject when saving fails (the form keeps what was typed). */
  create: (decision: DecisionInput) => Promise<void>
  update: (decisionId: string, decision: DecisionInput) => Promise<void>
  remove: (decisionId: string) => Promise<void>
}

// 決策紀錄: extracted in the background — asked for here, or by the pipeline once a meeting or interview is transcribed (so
// it can already be GENERATING when the page opens). While GENERATING it's asked for again every 3 seconds, and once it
// settles onSettled is told (the extraction used the model). Lives in the page, not the Studio card, so polling carries
// on while the phone's Studio sheet is closed (as quizzes).
export function useDecisions(jobId: string | undefined, isCompleted: boolean, onSettled: () => void): DecisionsActions {
  const [decisions, setDecisions] = useState<JobDecisions | null>(null)
  const [isRequesting, setIsRequesting] = useState(false)
  // Bumped on every change made here: a list asked for before it is out of date, so its answer is dropped rather than
  // let it undo the change (as use-translations).
  const localChanges = useRef(0)
  const list = useCallback((id: string) => {
    const asOf = localChanges.current
    return decisionsApi.list(id).then((latest) => (asOf === localChanges.current ? latest : null))
  }, [])

  useEffect(() => {
    if (!jobId || !isCompleted) return
    let cancelled = false
    list(jobId)
      .then((latest) => {
        if (!cancelled && latest) setDecisions(latest)
      })
      .catch(() => {}) // the card just offers to extract
    return () => {
      cancelled = true
    }
  }, [jobId, isCompleted, list])

  const generating = decisions?.extraction?.status === 'GENERATING'
  useEffect(() => {
    if (!jobId || !generating) return
    const timer = setInterval(() => {
      list(jobId)
        .then((latest) => {
          if (!latest) return
          setDecisions(latest)
          if (latest.extraction?.status !== 'GENERATING') onSettled()
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [jobId, generating, onSettled, list])

  const extract = useCallback(() => {
    if (!jobId || isRequesting) return
    setIsRequesting(true)
    decisionsApi
      .extract(jobId)
      .then((extraction) => setDecisions((prev) => ({ extraction, decisions: prev?.decisions ?? [] })))
      .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法開始抽取決策，請稍後再試'))
      .finally(() => setIsRequesting(false))
  }, [jobId, isRequesting])

  const change = useCallback((apply: (decisions: Decision[]) => Decision[]) => {
    localChanges.current += 1
    setDecisions((prev) => ({ extraction: prev?.extraction ?? null, decisions: inOrder(apply(prev?.decisions ?? [])) }))
  }, [])
  const create = useCallback(
    async (decision: DecisionInput) => {
      if (!jobId) return
      const created = await decisionsApi.create(jobId, decision)
      change((decisions) => [...decisions, created])
    },
    [jobId, change],
  )
  const update = useCallback(
    async (decisionId: string, decision: DecisionInput) => {
      if (!jobId) return
      const updated = await decisionsApi.update(jobId, decisionId, decision)
      change((decisions) => decisions.map((d) => (d.id === decisionId ? updated : d)))
    },
    [jobId, change],
  )
  const remove = useCallback(
    async (decisionId: string) => {
      if (!jobId) return
      await decisionsApi.remove(jobId, decisionId)
      change((decisions) => decisions.filter((d) => d.id !== decisionId))
    },
    [jobId, change],
  )

  return { decisions, isRequesting, extract, create, update, remove }
}

// As the server lists them: by time, those without one last (in the order they came).
function inOrder(decisions: Decision[]): Decision[] {
  return decisions
    .map((decision, i) => ({ decision, i }))
    .sort((a, b) => (a.decision.startTime ?? Infinity) - (b.decision.startTime ?? Infinity) || a.i - b.i)
    .map(({ decision }) => decision)
}
