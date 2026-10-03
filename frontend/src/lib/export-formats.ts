import { speakerNameLookup } from '@/lib/speakers'
import { computeSpeakerStats } from '@/lib/speaker-stats'
import { sortNotes } from '@/lib/notes'
import { isSummaryStale } from '@/lib/staleness'
import type { Chapter, Job, Note, QuizQuestion, SpeakerInsights, Summary, Transcript, WebSource } from '@/types/api'

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
  /** The job's title (標題), when it has one: the report's heading. */
  title?: string | null
  durationSeconds: number
  createdAt: string
  segments: ExportSegment[]
  summary: { text: string; isStale: boolean } | null
  chapters: { title: string; startTime: number }[]
  qaHistory: ExportQaTurn[]
  /** 筆記, by time with the unpinned ones last. */
  notes: ExportNote[]
  /** 講者數據; null (or absent) when speakers aren't shown. */
  speakerStats?: ExportSpeakerStats | null
}

/** 講者數據 in an export (see lib/speaker-stats): one row per speaker, by display order. */
export interface ExportSpeakerStats {
  speakers: { name: string; talkSeconds: number; share: number; turns: number; longestTurnSeconds: number; quiet: boolean }[]
  speakerChanges: number
  silenceSeconds: number
  /** The questions and possible interruptions judged by AI, when it has been analysed. */
  insights?: {
    isStale: boolean
    questions: { startTime: number; speakerName: string; text: string }[]
    interruptions: { startTime: number; speakerName: string; interruptedName: string; text: string }[]
  } | null
}

/** A 筆記 in an export: its time (null when not pinned to one) and text (empty for a 書籤). */
export interface ExportNote {
  timeSeconds: number | null
  text: string
}

/** One Q&A turn in an export: the answer, its recording timestamps and, when it searched the web (查網路), its web sources. */
export interface ExportQaTurn {
  question: string
  answer: string
  sourceTimestamps: number[]
  webSearch?: boolean
  webSources?: WebSource[]
}

export interface ExportSource {
  job: Job
  transcript: Transcript | null
  summary: Summary | null
  chapters: Chapter[]
  /** Q&A turns as shown in the Chat pane; a turn with a status other than 'done' is left out. */
  qaHistory: (ExportQaTurn & { status?: string })[]
  notes: Note[]
  /** 講者數據's AI part; left out of the report when it hasn't been analysed. */
  speakerInsights?: SpeakerInsights | null
}

export function buildExportContent(source: ExportSource): ExportContent {
  const { job, transcript, summary, chapters, qaHistory, notes } = source
  const speakerName = speakerNameLookup(transcript?.speakers ?? [])
  return {
    fileName: job.fileName,
    title: job.title ?? null,
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
      .map(({ question, answer, sourceTimestamps, webSearch, webSources }) => ({
        question,
        answer,
        sourceTimestamps,
        webSearch,
        webSources,
      })),
    notes: sortNotes(notes).map(({ timeSeconds, text }) => ({ timeSeconds, text })),
    speakerStats: exportSpeakerStats(transcript, source.speakerInsights ?? null),
  }
}

function exportSpeakerStats(transcript: Transcript | null, insights: SpeakerInsights | null): ExportSpeakerStats | null {
  const stats = transcript && computeSpeakerStats(transcript.segments, transcript.speakers)
  if (!transcript || !stats) return null
  const nameOf = (label: string | null) => speakerNameLookup(transcript.speakers)(label) ?? label ?? ''
  const analysed = insights && (insights.status === 'COMPLETED' || insights.completedAt !== null)
  return {
    insights: analysed
      ? {
          isStale: insights.sourceRevision !== transcript.revision,
          questions: insights.items
            .filter((item) => item.kind === 'question')
            .map((item) => ({ startTime: item.startTime, speakerName: nameOf(item.speakerLabel), text: item.text })),
          interruptions: insights.items
            .filter((item) => item.kind === 'interruption')
            .map((item) => ({
              startTime: item.startTime,
              speakerName: nameOf(item.speakerLabel),
              interruptedName: nameOf(item.interruptedLabel),
              text: item.text,
            })),
        }
      : null,
    speakers: stats.speakers.map(({ speaker, talkSeconds, share, turns, longestTurnSeconds, quiet }) => ({
      name: speaker.displayName, talkSeconds, share, turns, longestTurnSeconds, quiet,
    })),
    speakerChanges: stats.speakerChanges,
    silenceSeconds: stats.silenceSeconds,
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

// A page title as a Markdown link's text: brackets would end the text early.
function markdownLinkText(title: string) {
  return title.replace(/[[\]]/g, (bracket) => `\\${bracket}`)
}

// 筆記的 Markdown 清單：一則一項，有時間的前面是 [時間]，書籤寫成（書籤）；多行的文字縮排留在同一項裡。
function notesList(notes: ExportNote[]): string {
  return notes
    .map((note) => {
      const text = note.text ? note.text.replace(/\n/g, '\n  ') : '（書籤）'
      return note.timeSeconds !== null ? `- [${formatClock(note.timeSeconds)}] ${text}` : `- ${text}`
    })
    .join('\n')
}

// 單獨匯出的筆記：標題（沒有就檔名），有標題時列出檔名，然後是筆記清單。
export function toNotesMarkdown(content: Pick<ExportContent, 'fileName' | 'title' | 'notes'>): string {
  const blocks: string[] = [`# ${content.title || content.fileName}：筆記`]
  if (content.title) blocks.push(`- 檔名：${content.fileName}`)
  blocks.push(content.notes.length > 0 ? notesList(content.notes) : '尚無筆記')
  return blocks.join('\n\n') + '\n'
}

export const NOTES_MARKDOWN_FORMAT: ExportFormat = {
  label: '下載筆記（Markdown）',
  fileSuffix: '-筆記.md',
  mimeType: 'text/markdown',
  render: toNotesMarkdown,
}

// Markdown 報告：標題、長度與建立時間、摘要、章節、（有的話）筆記、逐字稿，最後是（有的話）問答紀錄。每一節都是一
// 個個以空行分隔的段落——Markdown 會把連續的行併成一段，所以逐字稿每個片段之間也空一行（行的內容
// 跟含時間戳 TXT 相同，只是多了空行）。
export function toMarkdownReport(content: ExportContent): string {
  // Headed by the title when the job has one; the file name then stays among the job's info.
  const blocks: string[] = [`# ${content.title || content.fileName}`]
  blocks.push(
    [
      ...(content.title ? [`- 檔名：${content.fileName}`] : []),
      `- 長度：${formatClock(content.durationSeconds)}`,
      `- 建立時間：${localDateTime(content.createdAt)}`,
    ].join('\n'),
  )

  blocks.push('## 摘要')
  if (content.summary?.isStale) blocks.push('> 逐字稿在摘要產生後有修改，摘要與章節可能過時')
  blocks.push(content.summary?.text ?? '尚無摘要')

  blocks.push('## 章節')
  blocks.push(
    content.chapters.length > 0
      ? content.chapters.map((chapter) => `- [${formatClock(chapter.startTime)}] ${chapter.title}`).join('\n')
      : '尚無章節',
  )

  if (content.speakerStats) {
    blocks.push('## 講者數據', speakerStatsTable(content.speakerStats))
  }

  if (content.notes.length > 0) {
    blocks.push('## 筆記', notesList(content.notes))
  }

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
      // Numbered like the answer's [n], so a reader of the file can follow them too.
      if (turn.webSources && turn.webSources.length > 0) {
        blocks.push('網路來源：', turn.webSources.map((source, i) => `${i + 1}. [${markdownLinkText(source.title)}](${source.url})`).join('\n'))
      } else if (turn.webSearch) {
        blocks.push('（這一題查了網路，但沒查到網路資料）')
      }
    }
  }

  return blocks.join('\n\n') + '\n'
}

function speakerStatsTable(stats: ExportSpeakerStats): string {
  const rows = stats.speakers.map((row) =>
    `| ${row.name}${row.quiet ? '（發言很少）' : ''} | ${formatClock(row.talkSeconds)} | ${Math.round(row.share * 100)}% | ${row.turns} | ${formatClock(row.longestTurnSeconds)} |`)
  return [
    '| 講者 | 發言時間 | 佔比 | 發言次數 | 最長一次 |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    `換人 ${stats.speakerChanges} 次；無人說話共 ${formatClock(stats.silenceSeconds)}。`,
    ...(stats.insights ? ['', insightsBlock(stats.insights)] : []),
  ].join('\n')
}

function insightsBlock(insights: NonNullable<ExportSpeakerStats['insights']>): string {
  const list = <T extends { startTime: number; text: string }>(items: T[], who: (item: T) => string) =>
    items.length > 0 ? items.map((item) => `- [${formatClock(item.startTime)}] ${who(item)}：${oneLine(item.text)}`).join('\n') : '（沒有）'
  return [
    '### 問題與打斷（AI 估計）',
    ...(insights.isStale ? ['', '> 逐字稿在分析後有修改，這份分析可能過時'] : []),
    '',
    '提出的問題：',
    '',
    list(insights.questions, (item) => item.speakerName),
    '',
    '可能的打斷：',
    '',
    list(insights.interruptions, (item) => `${item.speakerName} 打斷了 ${item.interruptedName}`),
  ].join('\n')
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

// The Q&A history and the notes only go into the report when the user opts in (they may not be meant for sharing).
export function markdownReportFormat({ includeQa, includeNotes }: { includeQa: boolean; includeNotes: boolean }): ExportFormat {
  return {
    label: '下載報告（Markdown）',
    fileSuffix: '-報告.md',
    mimeType: 'text/markdown',
    render: (content) =>
      toMarkdownReport({ ...content, qaHistory: includeQa ? content.qaHistory : [], notes: includeNotes ? content.notes : [] }),
  }
}

// 匯出檔名：原始檔名去掉最後一個副檔名，再接上格式自己的結尾（例如 `.srt`、`-含時間戳.txt`）。
export function exportFileName(originalFileName: string, suffix: string): string {
  const dot = originalFileName.lastIndexOf('.')
  const baseName = dot > 0 ? originalFileName.slice(0, dot) : originalFileName
  return baseName + suffix
}
