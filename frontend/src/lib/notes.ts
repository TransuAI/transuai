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
