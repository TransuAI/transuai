import { useMemo, useState } from 'react'
import { findTranscriptMatches, groupMatchesBySegment, type TranscriptMatch } from '@/lib/transcript-search'
import type { TranscriptSegment } from '@/types/api'

export interface TranscriptSearch {
  query: string
  changeQuery: (value: string) => void
  matchCount: number
  activeMatchIndex: number
  activeMatch: TranscriptMatch | null
  matchesBySegment: Map<number, TranscriptMatch[]>
  step: (direction: 1 | -1) => void
}

// Searching is reading, not following: typing a query or stepping between matches pauses
// auto-follow. Clearing the query deliberately does not resume it — only 回到播放位置 or a
// jump does (see frontend CONTEXT.md 自動跟隨).
export function useTranscriptSearch(segments: TranscriptSegment[], pauseFollow: () => void): TranscriptSearch {
  const [query, setQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const matches = useMemo(() => findTranscriptMatches(segments, query), [segments, query])
  const matchesBySegment = useMemo(() => groupMatchesBySegment(matches), [matches])
  // Editing a segment can remove matches; keep the selection within the ones that remain.
  const selectedIndex = matches.length === 0 ? 0 : Math.min(activeMatchIndex, matches.length - 1)

  const changeQuery = (value: string) => {
    setQuery(value)
    setActiveMatchIndex(0)
    if (value !== '') pauseFollow()
  }

  const step = (direction: 1 | -1) => {
    if (matches.length === 0) return
    setActiveMatchIndex((selectedIndex + direction + matches.length) % matches.length)
    pauseFollow()
  }

  return {
    query,
    changeQuery,
    matchCount: matches.length,
    activeMatchIndex: selectedIndex,
    activeMatch: matches[selectedIndex] ?? null,
    matchesBySegment,
    step,
  }
}
