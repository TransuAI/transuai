import { useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { downloadTextFile } from '@/lib/download'
import {
  buildExportContent,
  exportFileName,
  markdownReportFormat,
  PLAIN_TEXT_FORMAT,
  SRT_FORMAT,
  TIMESTAMPED_TEXT_FORMAT,
  VTT_FORMAT,
  type ExportFormat,
  type ExportSource,
} from '@/lib/export-formats'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const TRANSCRIPT_FORMATS: ExportFormat[] = [PLAIN_TEXT_FORMAT, TIMESTAMPED_TEXT_FORMAT, SRT_FORMAT, VTT_FORMAT]

// 匯出（見 frontend CONTEXT.md）：把工作區已經載入的內容轉成檔案，全部在瀏覽器裡完成。
// The export content is only assembled when a format is picked, not on every workspace render.
export function ExportMenu({ source }: { source: ExportSource }) {
  const hasTranscript = source.transcript !== null
  const [reportIncludesQa, setReportIncludesQa] = useState(false)
  const reportFormat = markdownReportFormat({ includeQa: reportIncludesQa })
  const download = (format: ExportFormat) => {
    const content = buildExportContent(source)
    downloadTextFile({
      fileName: exportFileName(content.fileName, format.fileSuffix),
      content: format.render(content),
      mimeType: format.mimeType,
    })
  }
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
