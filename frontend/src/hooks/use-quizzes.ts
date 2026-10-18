import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { quizApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import type { Quiz } from '@/types/api'

const POLL_INTERVAL_MS = 3000

// 測驗 (see ai-service CONTEXT.md): the job's quizzes, newest first. Generating one happens in the background;
// while any is still GENERATING the list is asked for again every 3 seconds, and once one settles (done or
// failed) onSettled is told — generating it used the model, so the usage has grown. Lives in the page, not the
// Studio card, so polling carries on while the phone's Studio sheet is closed.
export function useQuizzes(jobId: string | undefined, isCompleted: boolean, onSettled: () => void) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  // Between the click and the server's answer: one click is one request.
  const [isRequesting, setIsRequesting] = useState(false)
  // Bumped whenever a quiz is added here: a list asked for before that doesn't have it yet, so its answer is
  // dropped rather than let it take the new quiz off the card (and stop the polling for it).
  const localChanges = useRef(0)

  const list = useCallback(
    (jobId: string) => {
      const asOf = localChanges.current
      return quizApi.list(jobId).then((latest) => (asOf === localChanges.current ? latest : null))
    },
    [],
  )

  useEffect(() => {
    if (!jobId || !isCompleted) return
    let cancelled = false
    list(jobId)
      .then((latest) => {
        if (latest && !cancelled) setQuizzes(latest)
      })
      .catch(() => {}) // the card just shows none
    return () => {
      cancelled = true
    }
  }, [jobId, isCompleted, list])

  const generatingIds = quizzes
    .filter((quiz) => quiz.status === 'GENERATING')
    .map((quiz) => quiz.id)
    .join(',')

  useEffect(() => {
    if (!jobId || !generatingIds) return
    const waitingFor = generatingIds.split(',')
    const timer = setInterval(() => {
      list(jobId)
        .then((latest) => {
          if (!latest) return
          setQuizzes(latest)
          if (latest.some((quiz) => waitingFor.includes(quiz.id) && quiz.status !== 'GENERATING')) onSettled()
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [jobId, generatingIds, onSettled, list])

  // After an attempt: the best scores in the list may have changed.
  const reload = useCallback(() => {
    if (!jobId) return
    list(jobId)
      .then((latest) => {
        if (latest) setQuizzes(latest)
      })
      .catch(() => {})
  }, [jobId, list])

  const requestQuiz = useCallback(
    (questionCount: number) => {
      if (!jobId || isRequesting) return
      setIsRequesting(true)
      quizApi
        .request(jobId, questionCount)
        .then((quiz) => {
          localChanges.current += 1
          // A list that answered while this request was on its way may already have it: replace, don't add it twice.
          setQuizzes((prev) => [quiz, ...prev.filter((other) => other.id !== quiz.id)])
        })
        .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法產生測驗'))
        .finally(() => setIsRequesting(false))
    },
    [jobId, isRequesting],
  )

  return { quizzes, requestQuiz, isRequesting, reload }
}
