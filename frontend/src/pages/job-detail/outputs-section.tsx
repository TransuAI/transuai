import { useState, type FormEvent } from 'react'
import { ArrowLeft, Copy, Download, History, Loader2Icon, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { OutputsActions } from '@/hooks/use-outputs'
import { downloadTextFile } from '@/lib/download'
import { exportFileName } from '@/lib/export-formats'
import { OUTPUT_FORMAT_LABELS, SOCIAL_PLATFORMS, outputLabel, postLength } from '@/lib/output-formats'
import { formatShortDateTime } from '@/lib/media'
import { isOutputStale } from '@/lib/staleness'
import type { GeneratedOutput, OutputFormat, OutputRequest, SocialPlatform, Transcript } from '@/types/api'

// 多格式輸出 (see ai-service CONTEXT.md): new documents written from the job — not 匯出, which turns what's already there
// into files. Pick a kind to make one; each is listed, newest first, and opens to read, copy or download as Markdown.

export function OutputsSection({
  outputs: { outputs, isRequesting, request, update },
  fileName,
  transcript,
}: {
  outputs: OutputsActions
  fileName: string
  transcript: Transcript | null
}) {
  const [openedId, setOpenedId] = useState<string | null>(null)
  const opened = outputs.find((output) => output.id === openedId && output.status === 'COMPLETED')

  if (opened) {
    return (
      <OutputDocument
        output={opened}
        fileName={fileName}
        isStale={isOutputStale(opened, transcript)}
        onSave={(content) => update(opened.id, content)}
        onBack={() => setOpenedId(null)}
      />
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <h3>多格式輸出</h3>
      <p className="text-sm text-muted-foreground">依這段內容的摘要與章節，用 AI 寫成要發出去的文件；產生後可以複製或下載。</p>
      <OutputForm onRequest={request} isRequesting={isRequesting} />

      {outputs.length > 0 && (
        <ul aria-label="已產生的輸出" className="flex flex-col gap-2">
          {outputs.map((output) => (
            <li key={output.id}>
              <OutputItem
                output={output}
                isStale={isOutputStale(output, transcript)}
                onOpen={() => setOpenedId(output.id)}
                onRetry={() => request(requestFor(output))}
                isRequesting={isRequesting}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const MAX_INSTRUCTION_CHARS = 200

function OutputForm({ onRequest, isRequesting }: { onRequest: (params: OutputRequest) => void; isRequesting: boolean }) {
  const [format, setFormat] = useState<OutputFormat>('podcast_description')
  const [platform, setPlatform] = useState<SocialPlatform>('threads')
  const [instruction, setInstruction] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onRequest({
      format,
      ...(format === 'social_post' && { platform }),
      ...(instruction.trim() && { instruction: instruction.trim() }),
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="output-format">格式</Label>
          <select
            id="output-format"
            value={format}
            onChange={(event) => setFormat(event.target.value as OutputFormat)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            {(Object.keys(OUTPUT_FORMAT_LABELS) as OutputFormat[]).map((value) => (
              <option key={value} value={value}>{OUTPUT_FORMAT_LABELS[value]}</option>
            ))}
          </select>
        </div>
        {format === 'social_post' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="output-platform">平台</Label>
            <select
              id="output-platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as SocialPlatform)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {(Object.keys(SOCIAL_PLATFORMS) as SocialPlatform[]).map((value) => (
                <option key={value} value={value}>{SOCIAL_PLATFORMS[value].name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="output-instruction">要求（可省略）</Label>
        <Input
          id="output-instruction"
          value={instruction}
          maxLength={MAX_INSTRUCTION_CHARS}
          placeholder="例如：語氣輕鬆一點、寫給工程師看"
          onChange={(event) => setInstruction(event.target.value)}
        />
      </div>
      <Button type="submit" size="sm" className="w-fit" disabled={isRequesting}>
        產生
      </Button>
    </form>
  )
}

/** The same request again: what a failed output asked for. */
function requestFor(output: GeneratedOutput): OutputRequest {
  return {
    format: output.format,
    ...(output.platform && { platform: output.platform }),
    ...(output.instruction && { instruction: output.instruction }),
  }
}

function Marks({ output, isStale }: { output: GeneratedOutput; isStale: boolean }) {
  if (!output.editedAt && !isStale) return null
  return (
    <span className="flex gap-1">
      {output.editedAt && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">已修改</span>}
      {isStale && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">過時</span>}
    </span>
  )
}

function OutputItem({
  output,
  isStale,
  onOpen,
  onRetry,
  isRequesting,
}: {
  output: GeneratedOutput
  isStale: boolean
  onOpen: () => void
  onRetry: () => void
  isRequesting: boolean
}) {
  const label = outputLabel(output.format, output.platform)
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
        <Marks output={output} isStale={isStale} />
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

function OutputDocument({
  output,
  fileName,
  isStale,
  onSave,
  onBack,
}: {
  output: GeneratedOutput
  fileName: string
  isStale: boolean
  onSave: (content: string) => Promise<void>
  onBack: () => void
}) {
  const label = outputLabel(output.format, output.platform)
  const content = output.content ?? ''
  // The text being edited; null when not editing. Kept when saving fails so nothing typed is lost.
  const [draft, setDraft] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const save = () => {
    if (draft === null) return
    setIsSaving(true)
    setSaveFailed(false)
    onSave(draft)
      .then(() => setDraft(null))
      .catch(() => setSaveFailed(true))
      .finally(() => setIsSaving(false))
  }

  const cancel = () => {
    setDraft(null)
    setSaveFailed(false)
  }
  const shown = draft ?? content
  const length = output.format === 'social_post' && output.platform ? postLength(shown, output.platform) : null

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
      {isStale && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
          <History className="mt-0.5 size-4 shrink-0" />
          逐字稿已修改，這份可能過時
        </p>
      )}
      <article aria-label={label} className="flex flex-col gap-2">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          {label}
          <Marks output={output} isStale={false} />
        </h4>
        {draft === null ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap">{content}</div>
        ) : (
          <textarea
            aria-label={`${label}的內容`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancel()
            }}
            rows={16}
            className="w-full rounded-lg border bg-background p-3 font-mono text-sm leading-relaxed"
          />
        )}
      </article>
      {saveFailed && <p role="alert" className="text-sm text-destructive">修改沒有存到，請再試一次</p>}
      {length && output.platform && (
        <p className={length.over ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          <span>{`字數 ${length.length} / ${length.limit}`}</span>
          {length.over && (
            <span className="block">{`超過 ${SOCIAL_PLATFORMS[output.platform].name} 的字數上限，請刪減後再貼`}</span>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {draft === null ? (
          <Button size="sm" variant="outline" onClick={() => setDraft(content)}>
            <Pencil className="size-4" />
            編輯
          </Button>
        ) : (
          <>
            <Button size="sm" disabled={isSaving || !draft.trim()} onClick={save}>
              {isSaving ? '儲存中…' : '儲存'}
            </Button>
            <Button size="sm" variant="outline" disabled={isSaving} onClick={cancel}>
              取消
            </Button>
          </>
        )}
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
