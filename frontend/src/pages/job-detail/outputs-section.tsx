import { useState } from 'react'
import { ArrowLeft, Copy, Download, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { OutputsActions } from '@/hooks/use-outputs'
import { downloadTextFile } from '@/lib/download'
import { exportFileName } from '@/lib/export-formats'
import { OUTPUT_FORMAT_LABELS } from '@/lib/output-formats'
import { formatShortDateTime } from '@/lib/media'
import type { GeneratedOutput, OutputFormat } from '@/types/api'

// 多格式輸出 (see ai-service CONTEXT.md): new documents written from the job — not 匯出, which turns what's already there
// into files. Pick a kind to make one; each is listed, newest first, and opens to read, copy or download as Markdown.

export function OutputsSection({ outputs: { outputs, isRequesting, request }, fileName }: { outputs: OutputsActions; fileName: string }) {
  const [openedId, setOpenedId] = useState<string | null>(null)
  const opened = outputs.find((output) => output.id === openedId && output.status === 'COMPLETED')

  if (opened) {
    return <OutputDocument output={opened} fileName={fileName} onBack={() => setOpenedId(null)} />
  }

  return (
    <section className="flex flex-col gap-4">
      <h3>多格式輸出</h3>
      <p className="text-sm text-muted-foreground">依這段內容的摘要與章節，用 AI 寫成要發出去的文件；產生後可以複製或下載。</p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(OUTPUT_FORMAT_LABELS) as OutputFormat[]).map((format) => (
          <Button key={format} size="sm" variant="outline" disabled={isRequesting} onClick={() => request(format)}>
            {`產生 ${OUTPUT_FORMAT_LABELS[format]}`}
          </Button>
        ))}
      </div>

      {outputs.length > 0 && (
        <ul aria-label="已產生的輸出" className="flex flex-col gap-2">
          {outputs.map((output) => (
            <li key={output.id}>
              <OutputItem output={output} onOpen={() => setOpenedId(output.id)} onRetry={() => request(output.format)} isRequesting={isRequesting} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function OutputItem({
  output,
  onOpen,
  onRetry,
  isRequesting,
}: {
  output: GeneratedOutput
  onOpen: () => void
  onRetry: () => void
  isRequesting: boolean
}) {
  const label = OUTPUT_FORMAT_LABELS[output.format] ?? output.format
  const when = formatShortDateTime(output.completedAt ?? output.requestedAt)
  if (output.status === 'COMPLETED') {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
      >
        <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
          {label}
          <span className="text-xs font-normal text-muted-foreground">{when}</span>
        </span>
        <span className="line-clamp-2 text-sm text-muted-foreground">{output.content}</span>
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <span className="flex items-baseline justify-between gap-2 font-medium">
        {label}
        <span className="text-xs font-normal text-muted-foreground">{when}</span>
      </span>
      {output.status === 'GENERATING' ? (
        <p className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-4 animate-spin" />
          產生中…
        </p>
      ) : (
        <>
          <p className="text-destructive">{output.failureReason ?? '產生失敗'}</p>
          <Button size="sm" variant="outline" className="w-fit" disabled={isRequesting} onClick={onRetry}>
            再試一次
          </Button>
        </>
      )}
    </div>
  )
}

function OutputDocument({ output, fileName, onBack }: { output: GeneratedOutput; fileName: string; onBack: () => void }) {
  const label = OUTPUT_FORMAT_LABELS[output.format] ?? output.format
  const content = output.content ?? ''

  const copy = () => {
    navigator.clipboard.writeText(content).then(
      () => toast.success('已複製'),
      () => toast.error('無法複製，請改用下載'),
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <h3>多格式輸出</h3>
      <Button size="sm" variant="ghost" className="-ml-2 w-fit" onClick={onBack}>
        <ArrowLeft className="size-4" />
        所有輸出
      </Button>
      <article aria-label={label} className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">{label}</h4>
        <div className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap">{content}</div>
      </article>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={copy}>
          <Copy className="size-4" />
          複製
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            downloadTextFile({ fileName: exportFileName(fileName, `-${label}.md`), content, mimeType: 'text/markdown' })}
        >
          <Download className="size-4" />
          下載 Markdown
        </Button>
      </div>
      {output.model && <p className="text-xs text-muted-foreground/80">由 {output.model} 產生</p>}
    </section>
  )
}
