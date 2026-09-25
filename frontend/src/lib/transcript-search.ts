import type { TranscriptSegment } from '@/types/api'

export interface TranscriptMatch {
  segmentIndex: number
  start: number
  end: number
}

// 逐字稿搜尋：只比對片段文字（不比對講者名稱），英文不分大小寫，一個符合結果不會跨兩個片段。
export function findTranscriptMatches(segments: TranscriptSegment[], query: string): TranscriptMatch[] {
  if (query.trim() === '') return []
  const needle = query.toLowerCase()
  const matches: TranscriptMatch[] = []
  segments.forEach((segment, segmentIndex) => {
    // 少數字元（例如 İ）轉小寫後長度會變，位置就對不回原文；這種片段退回大小寫敏感比對。
    const lowered = segment.text.toLowerCase()
    const caseInsensitive = lowered.length === segment.text.length
    const haystack = caseInsensitive ? lowered : segment.text
    const target = caseInsensitive ? needle : query
    for (let at = haystack.indexOf(target); at !== -1; at = haystack.indexOf(target, at + target.length)) {
      matches.push({ segmentIndex, start: at, end: at + target.length })
    }
  })
  return matches
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
