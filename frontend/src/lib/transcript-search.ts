import type { TranscriptSegment } from '@/types/api'

export interface TranscriptMatch {
  segmentIndex: number
  start: number
  end: number
  /** In the segment's translation (雙語), not its text. */
  inTranslation?: boolean
}

// 逐字稿搜尋：只比對片段文字（不比對講者名稱），英文不分大小寫，一個符合結果不會跨兩個片段。雙語顯示時（translations 依片段順序，
// 沒有譯文是 null）也比對譯文，同一個片段裡原文的在前、譯文的在後。
export function findTranscriptMatches(
  segments: TranscriptSegment[],
  query: string,
  translations?: (string | null)[],
): TranscriptMatch[] {
  if (query.trim() === '') return []
  const matches: TranscriptMatch[] = []
  segments.forEach((segment, segmentIndex) => {
    for (const [start, end] of occurrences(segment.text, query)) matches.push({ segmentIndex, start, end })
    const translation = translations?.[segmentIndex]
    if (translation) {
      for (const [start, end] of occurrences(translation, query)) matches.push({ segmentIndex, start, end, inTranslation: true })
    }
  })
  return matches
}

function occurrences(text: string, query: string): [number, number][] {
  // 少數字元（例如 İ）轉小寫後長度會變，位置就對不回原文；這種文字退回大小寫敏感比對。
  const lowered = text.toLowerCase()
  const caseInsensitive = lowered.length === text.length
  const haystack = caseInsensitive ? lowered : text
  const target = caseInsensitive ? query.toLowerCase() : query
  const found: [number, number][] = []
  for (let at = haystack.indexOf(target); at !== -1; at = haystack.indexOf(target, at + target.length)) {
    found.push([at, at + target.length])
  }
  return found
}

export function groupMatchesBySegment(matches: TranscriptMatch[]): Map<number, TranscriptMatch[]> {
  const bySegment = new Map<number, TranscriptMatch[]>()
  for (const match of matches) {
    const group = bySegment.get(match.segmentIndex)
    if (group) group.push(match)
    else bySegment.set(match.segmentIndex, [match])
  }
  return bySegment
}
