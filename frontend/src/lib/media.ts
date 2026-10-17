import type { FileType } from '@/types/api'

export function detectFileType(file: File): FileType | null {
  if (file.type.startsWith('audio/')) return 'AUDIO'
  if (file.type.startsWith('video/')) return 'VIDEO'
  return null
}

export function readMediaDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio')
    const url = URL.createObjectURL(file)
    el.preload = 'metadata'
    el.src = url
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Math.round(el.duration))
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('無法讀取媒體檔案長度'))
    }
  })
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** A moment in local time with its year, as 「2026/9/26 14:07」 (the job list, a job still being processed). */
export function formatDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  return `${date.getFullYear()}/${formatShortDateTime(isoTimestamp)}`
}

/** A moment in local time as 「9/26 14:07」. */
export function formatShortDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}
