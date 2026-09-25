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

// 字幕時間碼：HH:MM:SS,mmm（SRT）或 HH:MM:SS.mmm（VTT）
function subtitleTimecode(seconds: number, millisecondSeparator: ',' | '.') {
  const totalMs = Math.round(seconds * 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}${millisecondSeparator}${pad(ms, 3)}`
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
    return `${i + 1}\n${subtitleTimecode(segment.startTime, ',')} --> ${subtitleTimecode(segment.endTime, ',')}\n${text}\n\n`
  })
  // BOM：舊版 Windows 播放器 / 剪輯軟體沒有 BOM 會把 UTF-8 中文當成 ANSI 讀成亂碼。
  return '﻿' + cues.join('')
}

// WebVTT 的字幕文字是 markup：& < > 要跳脫，否則會變成壞掉的標籤。
function escapeVtt(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function toVtt(segments: ExportSegment[]): string {
  const exportable = exportableSegments(segments)
  const labelSpeakers = hasMultipleSpeakers(exportable)
  const cues = exportable.map((segment) => {
    // 多位講者時用 WebVTT 標準的 voice span（<v 名稱>）標示誰在說話。
    const text =
      labelSpeakers && segment.speakerName
        ? `<v ${escapeVtt(segment.speakerName)}>${escapeVtt(segment.text)}`
        : escapeVtt(segment.text)
    return `${subtitleTimecode(segment.startTime, '.')} --> ${subtitleTimecode(segment.endTime, '.')}\n${text}\n\n`
  })
  return 'WEBVTT\n\n' + cues.join('')
}

// 文字格式：一個片段一行；多位講者時只在換人的那一行加「名稱：」，同一人連續的片段不重複。
function textFormatLines(segments: ExportSegment[], linePrefix: (segment: ExportSegment) => string): string {
  const exportable = exportableSegments(segments)
  const labelSpeakers = hasMultipleSpeakers(exportable)
  let previousSpeaker: string | null = null
  const lines = exportable.map((segment) => {
    const speakerChanged = labelSpeakers && segment.speakerName !== null && segment.speakerName !== previousSpeaker
    previousSpeaker = segment.speakerName
    return linePrefix(segment) + (speakerChanged ? `${segment.speakerName}：` : '') + segment.text
  })
  return lines.map((line) => line + '\n').join('')
}

export function toPlainText(segments: ExportSegment[]): string {
  return textFormatLines(segments, () => '')
}

export function toTimestampedText(segments: ExportSegment[]): string {
  return textFormatLines(segments, (segment) => `[${formatClock(segment.startTime)}] `)
}

export const SRT_FORMAT: ExportFormat = {
  label: '下載字幕（SRT）',
  fileSuffix: '.srt',
  mimeType: 'application/x-subrip',
  render: (content) => toSrt(content.segments),
}

export const VTT_FORMAT: ExportFormat = {
  label: '下載字幕（VTT）',
  fileSuffix: '.vtt',
  mimeType: 'text/vtt',
  render: (content) => toVtt(content.segments),
}

export const PLAIN_TEXT_FORMAT: ExportFormat = {
  label: '下載逐字稿（TXT，純文字）',
  fileSuffix: '.txt',
  mimeType: 'text/plain',
  render: (content) => toPlainText(content.segments),
}

export const TIMESTAMPED_TEXT_FORMAT: ExportFormat = {
  label: '下載逐字稿（TXT，含時間戳）',
  fileSuffix: '-含時間戳.txt',
  mimeType: 'text/plain',
  render: (content) => toTimestampedText(content.segments),
}

// 匯出檔名：原始檔名去掉最後一個副檔名，再接上格式自己的結尾（例如 `.srt`、`-含時間戳.txt`）。
export function exportFileName(originalFileName: string, suffix: string): string {
  const dot = originalFileName.lastIndexOf('.')
  const baseName = dot > 0 ? originalFileName.slice(0, dot) : originalFileName
  return baseName + suffix
}
