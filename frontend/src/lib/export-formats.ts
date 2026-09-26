import { speakerNameLookup } from '@/lib/speakers'
import { isSummaryStale } from '@/lib/staleness'
import type { Chapter, Job, QuizQuestion, Summary, Transcript } from '@/types/api'

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
  /** Q&A turns as shown in the Chat pane; a turn with a status other than 'done' is left out. */
  qaHistory: { question: string; answer: string; sourceTimestamps: number[]; status?: string }[]
}

export function buildExportContent(source: ExportSource): ExportContent {
  const { job, transcript, summary, chapters, qaHistory } = source
  const speakerName = speakerNameLookup(transcript?.speakers ?? [])
  return {
    fileName: job.fileName,
    durationSeconds: job.durationSeconds,
    createdAt: job.createdAt,
    segments:
      transcript?.segments.map((segment) => ({
        startTime: segment.startTime,
        endTime: segment.endTime,
        text: segment.text,
        speakerName: speakerName(segment.speakerLabel),
      })) ?? [],
    summary: summary ? { text: summary.summaryText, isStale: isSummaryStale(summary, transcript) } : null,
    chapters: chapters.map((chapter) => ({ title: chapter.title, startTime: chapter.startTime })),
    // A half-streamed or failed answer isn't something to hand to other people.
    qaHistory: qaHistory
      .filter((turn) => turn.status === undefined || turn.status === 'done')
      .map(({ question, answer, sourceTimestamps }) => ({ question, answer, sourceTimestamps })),
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

// 文字格式的逐字稿行：一個片段一行；多位講者時只在換人的那一行加「名稱：」，同一人連續的片段不重複。
function textFormatLines(segments: ExportSegment[], linePrefix: (segment: ExportSegment) => string): string[] {
  const exportable = exportableSegments(segments)
  const labelSpeakers = hasMultipleSpeakers(exportable)
  let previousSpeaker: string | null = null
  const lines = exportable.map((segment) => {
    const speakerChanged = labelSpeakers && segment.speakerName !== null && segment.speakerName !== previousSpeaker
    previousSpeaker = segment.speakerName
    return linePrefix(segment) + (speakerChanged ? `${segment.speakerName}：` : '') + segment.text
  })
  return lines
}

const timestampPrefix = (segment: ExportSegment) => `[${formatClock(segment.startTime)}] `

function asTextFile(lines: string[]) {
  return lines.map((line) => line + '\n').join('')
}

export function toPlainText(segments: ExportSegment[]): string {
  return asTextFile(textFormatLines(segments, () => ''))
}

export function toTimestampedText(segments: ExportSegment[]): string {
  return asTextFile(textFormatLines(segments, timestampPrefix))
}

// 建立時間用閱讀者的本地時間，跟工作區畫面上顯示的一致。
function localDateTime(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Markdown 報告：標題、長度與建立時間、摘要、章節、逐字稿，最後是（有的話）問答紀錄。每一節都是一
// 個個以空行分隔的段落——Markdown 會把連續的行併成一段，所以逐字稿每個片段之間也空一行（行的內容
// 跟含時間戳 TXT 相同，只是多了空行）。
export function toMarkdownReport(content: ExportContent): string {
  const blocks: string[] = [`# ${content.fileName}`]
  blocks.push(`- 長度：${formatClock(content.durationSeconds)}\n- 建立時間：${localDateTime(content.createdAt)}`)

  blocks.push('## 摘要')
  if (content.summary?.isStale) blocks.push('> 逐字稿在摘要產生後有修改，摘要與章節可能過時')
  blocks.push(content.summary?.text ?? '尚無摘要')

  blocks.push('## 章節')
  blocks.push(
    content.chapters.length > 0
      ? content.chapters.map((chapter) => `- [${formatClock(chapter.startTime)}] ${chapter.title}`).join('\n')
      : '尚無章節',
  )

  blocks.push('## 逐字稿')
  const transcriptLines = textFormatLines(content.segments, timestampPrefix)
  blocks.push(...(transcriptLines.length > 0 ? transcriptLines : ['尚無逐字稿']))

  if (content.qaHistory.length > 0) {
    blocks.push('## 問答紀錄')
    for (const turn of content.qaHistory) {
      // A Markdown heading is a single line.
      blocks.push(`### ${turn.question.replace(/\s*\n\s*/g, ' ')}`, turn.answer)
      if (turn.sourceTimestamps.length > 0) {
        blocks.push(`引用：${turn.sourceTimestamps.map((seconds) => `[${formatClock(seconds)}]`).join('、')}`)
      }
    }
  }

  return blocks.join('\n\n') + '\n'
}

// 測驗的 Markdown：題目與選項在前（可以印出來作答），最後一節是解答、解說與依據的時間戳。
export interface QuizExport {
  fileName: string
  /** When the quiz was made. */
  madeAt: string
  isStale: boolean
  questions: QuizQuestion[]
}

// 檔名結尾與 MIME（跟 ExportFormat 一樣），但輸入是整份測驗，所以 render 分開成 toQuizMarkdown。
export const QUIZ_MARKDOWN = { fileSuffix: '-測驗.md', mimeType: 'text/markdown' } as const

const optionLetter = (index: number) => String.fromCharCode(65 + index) // A, B, C, D

// A Markdown heading or list item is a single line.
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ')

export function toQuizMarkdown(quiz: QuizExport): string {
  const blocks: string[] = [`# ${quiz.fileName}：測驗`]
  blocks.push(`- 題數：${quiz.questions.length}\n- 產生時間：${localDateTime(quiz.madeAt)}`)
  if (quiz.isStale) blocks.push('> 逐字稿在測驗產生後有修改，這份測驗可能過時')

  blocks.push('## 題目')
  quiz.questions.forEach((question, i) => {
    blocks.push(`### ${i + 1}. ${oneLine(question.prompt)}`)
    blocks.push(question.options.map((option, j) => `- ${optionLetter(j)}. ${oneLine(option)}`).join('\n'))
  })

  blocks.push('## 解答')
  quiz.questions.forEach((question, i) => {
    blocks.push(`### ${i + 1}. ${optionLetter(question.correctOption)}. ${oneLine(question.options[question.correctOption])}`)
    blocks.push(question.explanation)
    if (question.sourceTimestamps.length > 0) {
      blocks.push(`依據：${question.sourceTimestamps.map((seconds) => `[${formatClock(seconds)}]`).join('、')}`)
    }
  })

  return blocks.join('\n\n') + '\n'
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

// The Q&A history only goes into the report when the user opts in (it may not be meant for sharing).
export function markdownReportFormat({ includeQa }: { includeQa: boolean }): ExportFormat {
  return {
    label: '下載報告（Markdown）',
    fileSuffix: '-報告.md',
    mimeType: 'text/markdown',
    render: (content) => toMarkdownReport(includeQa ? content : { ...content, qaHistory: [] }),
  }
}

// 匯出檔名：原始檔名去掉最後一個副檔名，再接上格式自己的結尾（例如 `.srt`、`-含時間戳.txt`）。
export function exportFileName(originalFileName: string, suffix: string): string {
  const dot = originalFileName.lastIndexOf('.')
  const baseName = dot > 0 ? originalFileName.slice(0, dot) : originalFileName
  return baseName + suffix
}
