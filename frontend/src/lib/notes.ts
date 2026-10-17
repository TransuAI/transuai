import type { Note } from '@/types/api'

// 筆記的順序（跟伺服器一樣）：依時間，沒有時間的在最後；同一個時間依建立順序。
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.timeSeconds !== b.timeSeconds) {
      if (a.timeSeconds === null) return 1
      if (b.timeSeconds === null) return -1
      return a.timeSeconds - b.timeSeconds
    }
    return a.createdAt.localeCompare(b.createdAt)
  })
}

// 筆記的時間只到十分之一秒：伺服器、列表、匯出看到的都是同一個數字。無條件捨去，才不會進位到錄音長度之後
//（伺服器不收）；1e-9 抵銷浮點誤差（2.3 * 10 是 22.999…）。
export function noteTime(seconds: number): number {
  return Math.floor(seconds * 10 + 1e-9) / 10
}

// 筆記的文字上限（跟伺服器一樣）。
export const NOTE_MAX_LENGTH = 2000

// 把問答的回答存成筆記時的文字：網路來源的 [n] 連結拿掉（筆記裡點不到），其他照舊；太長就截斷。
export function answerNoteText(answer: string, webSourceCount: number): string {
  const text = answer
    .replace(/\s?\[(\d+)\]/g, (link, n: string) => (Number(n) >= 1 && Number(n) <= webSourceCount ? '' : link))
    .trim()
  return text.length > NOTE_MAX_LENGTH ? `${text.slice(0, NOTE_MAX_LENGTH - 1)}…` : text
}

// 逐字稿上每個片段有哪些筆記：筆記落在哪個片段的時間裡；落在片段之間的空白，算在前一個片段（在第一個片段之前的算第一個）。
// segments 依時間排序。
export function notesBySegment(notes: Note[], segments: { startTime: number }[]): Map<number, Note[]> {
  const bySegment = new Map<number, Note[]>()
  if (segments.length === 0) return bySegment
  for (const note of notes) {
    if (note.timeSeconds === null) continue
    let index = 0
    for (let i = 0; i < segments.length && segments[i].startTime <= note.timeSeconds; i++) index = i
    bySegment.set(index, [...(bySegment.get(index) ?? []), note])
  }
  return bySegment
}
