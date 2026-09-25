import type { Chapter, Job, Summary, Transcript } from '@/types/api'

// 匯出（見 frontend CONTEXT.md）：把 Job 已經存在的內容轉成各種檔案格式的文字，不呼叫 LLM。
// 這裡只負責「內容長什麼樣」，下載 / 複製由呼叫端處理。

export interface ExportSegment {
  startTime: number
  endTime: number
  text: string
  /** The speaker's display name (講者), or null when the transcript has no speaker information. */
  speakerName: string | null
}

// Everything a format may draw on: the job's own info plus the content already loaded in the
// workspace. Each format picks what it needs.
export interface ExportContent {
  fileName: string
  durationSeconds: number
  createdAt: string
  segments: ExportSegment[]
  summary: { text: string; isStale: boolean } | null
  chapters: { title: string; startTime: number }[]
  qaHistory: { question: string; answer: string; sourceTimestamps: number[] }[]
}

export interface ExportSource {
  job: Job
  transcript: Transcript | null
  summary: Summary | null
  chapters: Chapter[]
  qaHistory: { question: string; answer: string; sourceTimestamps: number[] }[]
}

export function buildExportContent(source: ExportSource): ExportContent {
  const { job, transcript, summary, chapters, qaHistory } = source
  return {
    fileName: job.fileName,
    durationSeconds: job.durationSeconds,
    createdAt: job.createdAt,
    segments:
      transcript?.segments.map((segment) => ({
        startTime: segment.startTime,
        endTime: segment.endTime,
        text: segment.text,
        // Until speaker diarization provides display names, the raw label is all there is.
        speakerName: segment.speakerLabel,
      })) ?? [],
    // Whether the summary is 過時 comes from transcript editing (not built yet).
    summary: summary ? { text: summary.summaryText, isStale: false } : null,
    chapters: chapters.map((chapter) => ({ title: chapter.title, startTime: chapter.startTime })),
    qaHistory: qaHistory.map(({ question, answer, sourceTimestamps }) => ({ question, answer, sourceTimestamps })),
  }
}

export interface ExportFormat {
  label: string
  /** Appended to the uploaded file's name without its extension, e.g. `.srt`. */
  fileSuffix: string
  mimeType: string
  render: (content: ExportContent) => string
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0')
}

// 文字格式（TXT、Markdown）裡的時間戳：一小時內 mm:ss，一小時起 h:mm:ss。
export function formatClock(seconds: number): string {
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutesAndSeconds = `${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
  return hours > 0 ? `${hours}:${minutesAndSeconds}` : minutesAndSeconds
}

// SRT 時間碼：HH:MM:SS,mmm
function srtTimecode(seconds: number) {
  const totalMs = Math.round(seconds * 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)},${pad(ms, 3)}`
}

// 所有格式共用的規則：
// - 文字為空的片段（已清空片段）一律不匯出。
// - 只有在「有文字的片段」中出現兩位以上講者時才標示講者；單一講者的錄音不加「講者 1：」這種雜訊。
function exportableSegments(segments: ExportSegment[]) {
  return segments.filter((segment) => segment.text !== '')
}

function hasMultipleSpeakers(segments: ExportSegment[]) {
  return new Set(segments.map((segment) => segment.speakerName).filter(Boolean)).size >= 2
}

export function toSrt(segments: ExportSegment[]): string {
  const exportable = exportableSegments(segments)
  const labelSpeakers = hasMultipleSpeakers(exportable)
  const cues = exportable.map((segment, i) => {
    // 字幕一條一條分開顯示，所以多位講者時每一條都要帶名稱。
    const text = labelSpeakers && segment.speakerName ? `${segment.speakerName}：${segment.text}` : segment.text
    return `${i + 1}\n${srtTimecode(segment.startTime)} --> ${srtTimecode(segment.endTime)}\n${text}\n\n`
  })
  // BOM：舊版 Windows 播放器 / 剪輯軟體沒有 BOM 會把 UTF-8 中文當成 ANSI 讀成亂碼。
  return '﻿' + cues.join('')
}

export const SRT_FORMAT: ExportFormat = {
  label: '下載字幕（SRT）',
  fileSuffix: '.srt',
  mimeType: 'application/x-subrip',
  render: (content) => toSrt(content.segments),
}

// 匯出檔名：原始檔名去掉最後一個副檔名，再接上格式自己的結尾（例如 `.srt`、`-含時間戳.txt`）。
export function exportFileName(originalFileName: string, suffix: string): string {
  const dot = originalFileName.lastIndexOf('.')
  const baseName = dot > 0 ? originalFileName.slice(0, dot) : originalFileName
  return baseName + suffix
}
