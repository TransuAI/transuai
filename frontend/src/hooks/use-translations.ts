import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translationsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { currentTranslations } from '@/lib/current-translations'
import type { Transcript, TranslationDetail, TranslationLanguage, TranslationSummary } from '@/types/api'

const POLL_INTERVAL_MS = 3000
// After an edit ai-service re-translates the changed segments of every translated language (transcript.edited); the page
// can't see that start, so it keeps asking for this long, or until a translation is seen changing.
const FOLLOW_EDIT_MS = 60_000

/** What the transcript shows: the original, or a language's translation instead of it or under it. */
export type TranscriptDisplay = { mode: 'original' } | { mode: 'translated' | 'bilingual'; language: TranslationLanguage }

export interface TranslationsActions {
  translations: TranslationSummary[]
  display: TranscriptDisplay
  setDisplay: (display: TranscriptDisplay) => void
  /** The shown language's translations, by segment id (whatever is translated so far; not those translated from text
   *  that has since been edited). */
  texts: Map<string, string>
  isRequesting: boolean
  request: (language: TranslationLanguage) => void
  /** Deletes a language's translation; the transcript goes back to the original if it was showing it. */
  remove: (language: TranslationLanguage) => Promise<void>
}

// 譯文: the job's translations and what the transcript shows. While any is GENERATING the list is asked for again every
// 3 seconds; the shown language's segments are fetched again whenever more of them are ready, so a translation fills in
// batch by batch. After an edit it keeps asking for a while too (FOLLOW_EDIT_MS), so the re-translation shows up. Lives in
// the page so the desktop pane and the phone's Source sheet show the same thing.
export function useTranslations(
  jobId: string | undefined,
  isCompleted: boolean,
  onSettled: () => void,
  transcript: Transcript | null,
): TranslationsActions {
  const [translations, setTranslations] = useState<TranslationSummary[]>([])
  const [display, setDisplay] = useState<TranscriptDisplay>({ mode: 'original' })
  const [shownSegments, setShownSegments] = useState<TranslationDetail['segments']>([])
  const [isRequesting, setIsRequesting] = useState(false)
  const [followingEditUntil, setFollowingEditUntil] = useState<number | null>(null)
  // Bumped whenever a language is added or deleted here: a list asked for before that is out of date, so its answer is
  // dropped rather than let it bring a deleted language back or take a new one away (as use-quizzes).
  const localChanges = useRef(0)
  const list = useCallback((id: string) => {
    const asOf = localChanges.current
    return translationsApi.list(id).then((latest) => (asOf === localChanges.current ? latest : null))
  }, [])

  const revision = transcript?.revision
  const lastRevision = useRef(revision)
  useEffect(() => {
    const previous = lastRevision.current
    lastRevision.current = revision
    if (previous === undefined || revision === undefined || revision <= previous) return
    if (translations.some((t) => t.status === 'COMPLETED')) setFollowingEditUntil(Date.now() + FOLLOW_EDIT_MS)
  }, [revision, translations])

  useEffect(() => {
    if (!jobId || !isCompleted) return
    let cancelled = false
    list(jobId)
      .then((latest) => {
        if (!cancelled && latest) setTranslations(latest)
      })
      .catch(() => {}) // the bar just offers to translate
    return () => {
      cancelled = true
    }
  }, [jobId, isCompleted, list])

  const generating = translations.filter((t) => t.status === 'GENERATING').map((t) => t.language).join(',')
  useEffect(() => {
    if (!jobId || (!generating && followingEditUntil === null)) return
    const waitingFor = generating.split(',')
    const timer = setInterval(() => {
      list(jobId)
        .then((latest) => {
          if (!latest) return
          setTranslations(latest)
          if (latest.some((t) => waitingFor.includes(t.language) && t.status !== 'GENERATING')) onSettled()
          const changed = latest.some((t) => {
            const was = translations.find((b) => b.language === t.language)
            return t.status === 'GENERATING' || t.completedAt !== was?.completedAt
          })
          if (changed || (followingEditUntil !== null && Date.now() >= followingEditUntil)) setFollowingEditUntil(null)
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
    // Each poll's result restarts the timer (through `translations`), so the next one compares against it.
  }, [jobId, generating, followingEditUntil, translations, onSettled, list])

  const shownLanguage = display.mode === 'original' ? null : display.language
  const shown = translations.find((t) => t.language === shownLanguage)
  // A re-translation after an edit keeps the count the same; the time it finished tells it apart.
  const shownVersion = `${shown?.translatedSegments ?? 0}:${shown?.completedAt ?? ''}`
  useEffect(() => {
    if (!jobId || !shownLanguage) {
      setShownSegments([])
      return
    }
    let cancelled = false
    translationsApi
      .get(jobId, shownLanguage)
      .then((detail) => {
        if (!cancelled) setShownSegments(detail.segments)
      })
      .catch(() => {}) // keeps what's shown; the next progress tries again
    return () => {
      cancelled = true
    }
  }, [jobId, shownLanguage, shownVersion])
  const texts = useMemo(() => currentTranslations(shownSegments, transcript), [shownSegments, transcript])

  const request = useCallback(
    (language: TranslationLanguage) => {
      if (!jobId || isRequesting) return
      setIsRequesting(true)
      translationsApi
        .request(jobId, language)
        .then((translation) => {
          localChanges.current += 1
          setTranslations((prev) => [...prev.filter((t) => t.language !== language), translation])
          setDisplay({ mode: 'translated', language })
        })
        .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法開始翻譯，請稍後再試'))
        .finally(() => setIsRequesting(false))
    },
    [jobId, isRequesting],
  )

  const remove = useCallback(
    async (language: TranslationLanguage) => {
      if (!jobId) return
      try {
        await translationsApi.delete(jobId, language)
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : '無法刪除譯文，請稍後再試')
        return
      }
      localChanges.current += 1
      setTranslations((prev) => prev.filter((t) => t.language !== language))
      setDisplay((current) => (current.mode !== 'original' && current.language === language ? { mode: 'original' } : current))
    },
    [jobId],
  )

  return { translations, display, setDisplay, texts, isRequesting, request, remove }
}

