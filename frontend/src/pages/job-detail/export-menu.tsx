import { useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { jobsApi, quizApi } from '@/lib/api'
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
import type { Quiz } from '@/types/api'

const TRANSCRIPT_FORMATS: ExportFormat[] = [PLAIN_TEXT_FORMAT, TIMESTAMPED_TEXT_FORMAT, SRT_FORMAT, VTT_FORMAT]

// 匯出（見 frontend CONTEXT.md）：把工作區已經載入的內容轉成檔案，全部在瀏覽器裡完成。
// The export content is only assembled when a format is picked, not on every workspace render.
export function ExportMenu({ source, quizzes }: { source: ExportSource; quizzes: Quiz[] }) {
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
