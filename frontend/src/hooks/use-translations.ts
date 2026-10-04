import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { translationsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import type { TranslationLanguage, TranslationSummary } from '@/types/api'

const POLL_INTERVAL_MS = 3000

/** What the transcript shows: the original, or a language's translation instead of it or under it. */
export type TranscriptDisplay = { mode: 'original' } | { mode: 'translated' | 'bilingual'; language: TranslationLanguage }

export interface TranslationsActions {
  translations: TranslationSummary[]
  display: TranscriptDisplay
  setDisplay: (display: TranscriptDisplay) => void
  /** The shown language's translations, by segment id (whatever is translated so far). */
  texts: Map<string, string>
  isRequesting: boolean
  request: (language: TranslationLanguage) => void
}

// 譯文: the job's translations and what the transcript shows. While any is GENERATING the list is asked for again every
// 3 seconds; the shown language's segments are fetched again whenever more of them are ready, so a translation fills in
// batch by batch. Lives in the page so the desktop pane and the phone's Source sheet show the same thing.
export function useTranslations(jobId: string | undefined, isCompleted: boolean, onSettled: () => void): TranslationsActions {
  const [translations, setTranslations] = useState<TranslationSummary[]>([])
  const [display, setDisplay] = useState<TranscriptDisplay>({ mode: 'original' })
  const [texts, setTexts] = useState<Map<string, string>>(new Map())
  const [isRequesting, setIsRequesting] = useState(false)

  useEffect(() => {
    if (!jobId || !isCompleted) return
    let cancelled = false
    translationsApi
      .list(jobId)
      .then((latest) => {
        if (!cancelled) setTranslations(latest)
      })
      .catch(() => {}) // the bar just offers to translate
    return () => {
      cancelled = true
    }
  }, [jobId, isCompleted])

  const generating = translations.filter((t) => t.status === 'GENERATING').map((t) => t.language).join(',')
  useEffect(() => {
    if (!jobId || !generating) return
    const waitingFor = generating.split(',')
    const timer = setInterval(() => {
      translationsApi
        .list(jobId)
        .then((latest) => {
          setTranslations(latest)
          if (latest.some((t) => waitingFor.includes(t.language) && t.status !== 'GENERATING')) onSettled()
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [jobId, generating, onSettled])

  const shownLanguage = display.mode === 'original' ? null : display.language
  const shownProgress = translations.find((t) => t.language === shownLanguage)?.translatedSegments ?? 0
  useEffect(() => {
    if (!jobId || !shownLanguage) {
      setTexts(new Map())
      return
    }
    let cancelled = false
    translationsApi
      .get(jobId, shownLanguage)
      .then((detail) => {
        if (!cancelled) setTexts(new Map(detail.segments.map((s) => [s.segmentId, s.text])))
      })
      .catch(() => {}) // keeps what's shown; the next progress tries again
    return () => {
      cancelled = true
    }
  }, [jobId, shownLanguage, shownProgress])

  const request = useCallback(
    (language: TranslationLanguage) => {
      if (!jobId || isRequesting) return
      setIsRequesting(true)
      translationsApi
        .request(jobId, language)
        .then((translation) => {
          setTranslations((prev) => [...prev.filter((t) => t.language !== language), translation])
          setDisplay({ mode: 'translated', language })
        })
        .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法開始翻譯，請稍後再試'))
        .finally(() => setIsRequesting(false))
    },
    [jobId, isRequesting],
  )

  return { translations, display, setDisplay, texts, isRequesting, request }
}
