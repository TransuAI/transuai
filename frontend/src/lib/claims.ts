import type { Claim } from '@/types/api'

// 逐字稿上每個片段被標出哪些主張：主張的時間點就是說它的那個片段的開始；落在片段之間（片段之後被編輯過）的算在前一個片段。
// segments 依時間排序。
export function claimsBySegment(claims: Claim[], segments: { startTime: number }[]): Map<number, Claim[]> {
  const bySegment = new Map<number, Claim[]>()
  if (segments.length === 0) return bySegment
  for (const claim of claims) {
    let index = 0
    // Claims keep two decimals of the time: a segment starting within that rounding is the one.
    for (let i = 0; i < segments.length && segments[i].startTime <= claim.startTime + 0.005; i++) index = i
    bySegment.set(index, [...(bySegment.get(index) ?? []), claim])
  }
  return bySegment
}

export const VERDICT_LABELS: Record<NonNullable<Claim['verdict']>, string> = {
  supported: '有依據',
  disputed: '有出入',
  no_reliable_source: '查不到可靠來源',
  not_checkable: '無法查核',
}

export const KIND_LABELS: Record<Claim['kind'], string> = { number: '數字', fact: '事實' }
