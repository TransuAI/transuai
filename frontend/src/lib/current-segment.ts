import type { TranscriptSegment } from '@/types/api'

// 規則見 frontend CONTEXT.md「目前片段」。片段依開始時間排序，二分搜尋「開始時間 ≤ 播放時間」的最後
// 一個片段，空隙的情況就自然落在前一個片段上；30 分鐘的錄音有好幾百個片段，每次 timeupdate 都線性
// 掃過一遍沒必要。
export function findCurrentSegmentIndex(segments: TranscriptSegment[], time: number): number | null {
  let low = 0
  let high = segments.length - 1
  let found: number | null = null
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (segments[mid].startTime <= time) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  if (found === segments.length - 1 && time >= segments[found].endTime) return null
  return found
}
