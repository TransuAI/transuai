import { useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { jobsApi, quizApi, translationsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { downloadTextFile, openDownloadUrl, fileNameWithSuffix } from '@/lib/download'
import {
  buildExportContent,
  markdownReportFormat,
  NOTES_MARKDOWN_FORMAT,
  PLAIN_TEXT_FORMAT,
  QUIZ_MARKDOWN,
  SRT_FORMAT,
  TIMESTAMPED_TEXT_FORMAT,
  toQuizMarkdown,
  VTT_FORMAT,
  withTranslation,
  type ExportFormat,
  type ExportSource,
} from '@/lib/export-formats'
import { formatShortDateTime } from '@/lib/media'
import { isQuizStale } from '@/lib/staleness'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { currentTranslations } from '@/lib/current-translations'
import { TRANSLATION_LANGUAGES } from '@/lib/translation-languages'
import type { Quiz, TranslationLanguage, TranslationSummary } from '@/types/api'

const TRANSCRIPT_FORMATS: ExportFormat[] = [PLAIN_TEXT_FORMAT, TIMESTAMPED_TEXT_FORMAT, SRT_FORMAT, VTT_FORMAT]

// 匯出（見 frontend CONTEXT.md）：把工作區已經載入的內容轉成檔案，全部在瀏覽器裡完成。
// The export content is only assembled when a format is picked, not on every workspace render.
// 譯文的匯出：每種已經有譯文的語言，譯文取代原文的 TXT／SRT／VTT，與雙語（每段原文在上、譯文在下）的 TXT／SRT／VTT。
const TRANSLATED_FORMATS = [
  { id: 'txt', mode: 'translated', format: PLAIN_TEXT_FORMAT, label: (name: string) => `譯文（${name}，TXT）`, suffix: (l: string) => `-${l}.txt` },
  { id: 'srt', mode: 'translated', format: SRT_FORMAT, label: (name: string) => `譯文字幕（${name}，SRT）`, suffix: (l: string) => `-${l}.srt` },
  { id: 'vtt', mode: 'translated', format: VTT_FORMAT, label: (name: string) => `譯文字幕（${name}，VTT）`, suffix: (l: string) => `-${l}.vtt` },
  { id: 'bilingual-txt', mode: 'bilingual', format: PLAIN_TEXT_FORMAT, label: (name: string) => `雙語（${name}，TXT）`, suffix: (l: string) => `-雙語-${l}.txt` },
  { id: 'bilingual-srt', mode: 'bilingual', format: SRT_FORMAT, label: (name: string) => `雙語字幕（${name}，SRT）`, suffix: (l: string) => `-雙語-${l}.srt` },
  { id: 'bilingual-vtt', mode: 'bilingual', format: VTT_FORMAT, label: (name: string) => `雙語字幕（${name}，VTT）`, suffix: (l: string) => `-雙語-${l}.vtt` },
] as const

export function ExportMenu({
  source,
  quizzes,
  translations = [],
}: {
  source: ExportSource
  quizzes: Quiz[]
  translations?: TranslationSummary[]
}) {
  const hasTranscript = source.transcript !== null
  const [reportIncludesQa, setReportIncludesQa] = useState(false)
  const [reportIncludesNotes, setReportIncludesNotes] = useState(false)
  const reportFormat = markdownReportFormat({ includeQa: reportIncludesQa, includeNotes: reportIncludesNotes })
  const download = (format: ExportFormat) => {
    const content = buildExportContent(source)
    downloadTextFile({
      fileName: fileNameWithSuffix(content.fileName, format.fileSuffix),
      content: format.render(content),
      mimeType: format.mimeType,
    })
  }
  // 測驗：列表裡沒有題目，選了才載入整份測驗。
  const doneQuizzes = quizzes.filter((quiz) => quiz.status === 'COMPLETED')
  const downloadQuiz = (quiz: Quiz) =>
    quizApi.get(source.job.jobId, quiz.id).then(
      (full) => {
        if (!full.questions?.length) {
          toast.error('無法下載測驗')
          return
        }
        downloadTextFile({
          fileName: fileNameWithSuffix(source.job.fileName, QUIZ_MARKDOWN.fileSuffix),
          content: toQuizMarkdown({
            fileName: source.job.fileName,
            madeAt: full.completedAt ?? full.requestedAt,
            isStale: isQuizStale(full, source.transcript),
            questions: full.questions,
          }),
          mimeType: QUIZ_MARKDOWN.mimeType,
        })
      },
      (err) => toast.error(err instanceof ApiError ? err.message : '無法下載測驗'),
    )
  // 譯文：選了才載入那種語言的片段譯文。
  const translated = translations.filter((t) => t.translatedSegments > 0)
  const downloadTranslated = (language: TranslationLanguage, choice: (typeof TRANSLATED_FORMATS)[number]) =>
    translationsApi.get(source.job.jobId, language).then(
      (detail) => {
        const texts = currentTranslations(detail.segments, source.transcript)
        const byPosition = new Map<number, string>()
        source.transcript?.segments.forEach((segment, i) => {
          const text = texts.get(segment.id)
          if (text !== undefined) byPosition.set(i, text)
        })
        const content = buildExportContent(source)
        downloadTextFile({
          fileName: fileNameWithSuffix(content.fileName, choice.suffix(language)),
          content: choice.format.render({ ...content, segments: withTranslation(content.segments, byPosition, choice.mode) }),
          mimeType: choice.format.mimeType,
        })
      },
      (err) => toast.error(err instanceof ApiError ? err.message : '無法下載譯文'),
    )
  const downloadOriginal = () =>
    jobsApi.getMediaUrl(source.job.jobId, { download: true }).then(
      (response) => openDownloadUrl(response.downloadUrl),
      (err) => toast.error(err instanceof ApiError ? err.message : '無法下載原始檔'),
    )
  const copy = (text: string, label: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(`已複製${label}`),
      () => toast.error('複製失敗'),
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="size-4" />
          匯出
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        {TRANSCRIPT_FORMATS.map((format) => (
          <DropdownMenuItem key={format.fileSuffix} disabled={!hasTranscript} onSelect={() => download(format)}>
            {format.label}
          </DropdownMenuItem>
        ))}
        {translated.map((t) => (
          <div key={t.language}>
            <DropdownMenuSeparator />
            {TRANSLATED_FORMATS.map((choice) => (
              <DropdownMenuItem key={choice.id} onSelect={() => void downloadTranslated(t.language, choice)}>
                {choice.label(TRANSLATION_LANGUAGES[t.language])}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => download(reportFormat)}>{reportFormat.label}</DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={reportIncludesQa}
          onCheckedChange={(checked) => setReportIncludesQa(checked === true)}
          // Keep the menu open so the user can go on to download the report.
          onSelect={(event) => event.preventDefault()}
        >
          報告包含問答紀錄
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={reportIncludesNotes}
          onCheckedChange={(checked) => setReportIncludesNotes(checked === true)}
          onSelect={(event) => event.preventDefault()}
        >
          報告包含筆記
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem disabled={source.notes.length === 0} onSelect={() => download(NOTES_MARKDOWN_FORMAT)}>
          {NOTES_MARKDOWN_FORMAT.label}
        </DropdownMenuItem>
        {doneQuizzes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {doneQuizzes.map((quiz) => (
              <DropdownMenuItem key={quiz.id} onSelect={() => void downloadQuiz(quiz)}>
                下載測驗（{quiz.questionCount} 題，{formatShortDateTime(quiz.completedAt ?? quiz.requestedAt)}，Markdown）
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!hasTranscript}
          // 複製逐字稿＝TXT 純文字的內容。
          onSelect={() => copy(PLAIN_TEXT_FORMAT.render(buildExportContent(source)), '逐字稿')}
        >
          複製逐字稿
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!source.summary}
          onSelect={() => {
            const { summary } = buildExportContent(source)
            if (summary) void copy(summary.text, '摘要')
          }}
        >
          複製摘要
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void downloadOriginal()}>下載原始檔</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
