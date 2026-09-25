import { Download } from 'lucide-react'
import { downloadTextFile } from '@/lib/download'
import { buildExportContent, exportFileName, SRT_FORMAT, type ExportFormat, type ExportSource } from '@/lib/export-formats'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const TRANSCRIPT_FORMATS: ExportFormat[] = [SRT_FORMAT]

// 匯出（見 frontend CONTEXT.md）：把工作區已經載入的內容轉成檔案，全部在瀏覽器裡完成。
// The export content is only assembled when a format is picked, not on every workspace render.
export function ExportMenu({ source }: { source: ExportSource }) {
  const hasTranscript = source.transcript !== null
  const download = (format: ExportFormat) => {
    const content = buildExportContent(source)
    downloadTextFile({
      fileName: exportFileName(content.fileName, format.fileSuffix),
      content: format.render(content),
      mimeType: format.mimeType,
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="size-4" />
          匯出
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {TRANSCRIPT_FORMATS.map((format) => (
          <DropdownMenuItem key={format.fileSuffix} disabled={!hasTranscript} onSelect={() => download(format)}>
            {format.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
