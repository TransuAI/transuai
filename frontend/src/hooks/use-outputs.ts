import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { outputsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import type { GeneratedOutput, OutputRequest } from '@/types/api'

const POLL_INTERVAL_MS = 3000

export interface OutputsActions {
  outputs: GeneratedOutput[]
  isRequesting: boolean
  request: (params: OutputRequest) => void
}

// 多格式輸出: the job's outputs, newest first. Each is made in the background; while any is GENERATING the list is asked for
// again every 3 seconds, and once one settles onSettled is told (it used the model, so the usage has grown). Lives in the
// page, not the Studio card, so polling carries on while the phone's Studio sheet is closed (as quizzes).
export function useOutputs(jobId: string | undefined, isCompleted: boolean, onSettled: () => void): OutputsActions {
  const [outputs, setOutputs] = useState<GeneratedOutput[]>([])
  const [isRequesting, setIsRequesting] = useState(false)
  // Bumped whenever an output is added here: a list asked for before that doesn't have it yet, so its answer is dropped
  // rather than let it take the new output off the card (as quizzes).
  const localChanges = useRef(0)

  const list = useCallback((jobId: string) => {
    const asOf = localChanges.current
    return outputsApi.list(jobId).then((latest) => (asOf === localChanges.current ? latest : null))
  }, [])

  useEffect(() => {
    if (!jobId || !isCompleted) return
    let cancelled = false
    list(jobId)
      .then((latest) => {
        if (latest && !cancelled) setOutputs(latest)
      })
      .catch(() => {}) // the card just shows none
    return () => {
      cancelled = true
    }
  }, [jobId, isCompleted, list])

  const generatingIds = outputs.filter((output) => output.status === 'GENERATING').map((output) => output.id).join(',')

  useEffect(() => {
    if (!jobId || !generatingIds) return
    const waitingFor = generatingIds.split(',')
    const timer = setInterval(() => {
      list(jobId)
        .then((latest) => {
          if (!latest) return
          setOutputs(latest)
          if (latest.some((output) => waitingFor.includes(output.id) && output.status !== 'GENERATING')) onSettled()
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [jobId, generatingIds, onSettled, list])

  const request = useCallback(
    (params: OutputRequest) => {
      if (!jobId || isRequesting) return
      setIsRequesting(true)
      outputsApi
        .request(jobId, params)
        .then((output) => {
          localChanges.current += 1
          setOutputs((prev) => [output, ...prev])
        })
        .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法產生，請稍後再試'))
        .finally(() => setIsRequesting(false))
    },
    [jobId, isRequesting],
  )

  return { outputs, isRequesting, request }
}
