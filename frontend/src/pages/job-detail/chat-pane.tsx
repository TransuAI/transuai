import { AlertCircle, Globe, Loader2Icon, MessageCircle } from 'lucide-react'
import { modelLabel } from '@/lib/providers'
import { cn } from '@/lib/utils'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ModelChoice, WebSource } from '@/types/api'

export type QaEntryStatus = 'streaming' | 'done' | 'error'

const choiceKey = (choice: ModelChoice) => `${choice.provider}/${choice.model}`

export interface QaEntry {
  id: string
  question: string
  answer: string
  sourceTimestamps: number[]
  status: QaEntryStatus
  /** The model that answered, once known. */
  model?: string | null
  /** This question also searched the web (查網路). */
  webSearch?: boolean
  /** The web pages the answer drew on, numbered as its [n]; empty once known that the search found nothing to use. */
  webSources?: WebSource[]
}

interface ChatPaneProps {
  qaHistory: QaEntry[]
  isLoadingHistory: boolean
  questionInput: string
  onQuestionInputChange: (value: string) => void
  isAsking: boolean
  onAsk: () => void
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  /** Models the user can answer with (see 預設模型), and the one picked for the next question. */
  modelChoices: ModelChoice[]
  selectedModel: ModelChoice | null
  onSelectModel: (model: ModelChoice) => void
  /** 查網路 (see ai-service CONTEXT.md「網路搜尋」): shown only when the deployment can search; stays as set. */
  webSearchAvailable: boolean
  webSearch: boolean
  onWebSearchChange: (on: boolean) => void
}

const WEB_LINK = { target: '_blank', rel: 'noopener noreferrer' } as const

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// The answer, with each [n] that points at one of its web sources turned into a small link to that page. Any other
// bracketed number is left as text.
function AnswerText({ text, webSources }: { text: string; webSources: WebSource[] }) {
  if (webSources.length === 0) return <>{text}</>
  return (
    <>
      {text.split(/(\[\d+\])/).map((part, i) => {
        const n = /^\[(\d+)\]$/.exec(part)?.[1]
        const source = n ? webSources[Number(n) - 1] : undefined
        if (!source) return part
        return (
          <a
            key={i}
            href={source.url}
            {...WEB_LINK}
            aria-label={`網路來源 ${n}`}
            title={source.title}
            className="mx-0.5 align-super text-[0.7em] font-medium text-primary hover:underline"
          >
            [{n}]
          </a>
        )
      })}
    </>
  )
}

// 網路來源: numbered like the answer's [n], each opening its page in a new tab.
function WebSourceList({ sources }: { sources: WebSource[] }) {
  return (
    <div className="flex flex-col gap-1 pt-1">
      <p aria-hidden className="text-xs font-medium text-muted-foreground">
        網路來源
      </p>
      <ol aria-label="網路來源" className="flex flex-col gap-1">
        {sources.map((source, i) => (
          <li key={`${i}-${source.url}`}>
            <a
              href={source.url}
              {...WEB_LINK}
              title={source.url}
              className="group flex items-baseline gap-2 rounded-sm text-xs text-muted-foreground"
            >
              <span className="shrink-0 tabular-nums">[{i + 1}]</span>
              <span className="min-w-0 truncate text-foreground group-hover:underline">{source.title}</span>
              <span className="shrink-0">{siteOf(source.url)}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function ChatPane({
  qaHistory,
  isLoadingHistory,
  questionInput,
  onQuestionInputChange,
  isAsking,
  onAsk,
  onSeek,
  mediaAvailable,
  modelChoices,
  selectedModel,
  onSelectModel,
  webSearchAvailable,
  webSearch,
  onWebSearchChange,
}: ChatPaneProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col gap-0 py-0">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <MessageCircle className="size-4 text-primary" />
        <h2 className="text-sm font-medium">問答</h2>
      </div>
      <CardContent className="min-h-0 flex-1 py-4">
        {isLoadingHistory ? (
          <div className="flex h-full items-center justify-center">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : qaHistory.length > 0 ? (
          <ScrollArea className="h-full pr-4">
            <div className="flex flex-col gap-4">
              {qaHistory.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-start gap-1.5">
                    <p className="text-sm font-medium">{entry.question}</p>
                    {entry.webSearch && (
                      <span title="這一題也查了網路" className="mt-0.5 shrink-0 text-muted-foreground">
                        <Globe aria-hidden className="size-3.5" />
                        <span className="sr-only">（查了網路）</span>
                      </span>
                    )}
                  </div>
                  {entry.answer && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                      <AnswerText text={entry.answer} webSources={entry.webSources ?? []} />
                    </p>
                  )}
                  {entry.model && entry.status !== 'error' && (
                    <p className="text-xs text-muted-foreground/80">由 {entry.model} 回答</p>
                  )}
                  {entry.status === 'streaming' && (
                    <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                  )}
                  {entry.status === 'error' && (
                    <p className="flex items-center gap-1.5 text-sm text-destructive">
                      <AlertCircle className="size-3.5" />
                      回答失敗，請重新提問
                    </p>
                  )}
                  {entry.sourceTimestamps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {entry.sourceTimestamps.map((ts, j) => (
                        <TimestampButton key={j} seconds={ts} onSeek={onSeek} mediaAvailable={mediaAvailable} />
                      ))}
                    </div>
                  )}
                  {entry.webSources && entry.webSources.length > 0 && <WebSourceList sources={entry.webSources} />}
                  {entry.webSearch && entry.webSources?.length === 0 && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Globe aria-hidden className="size-3.5" />
                      這次沒查到網路資料，只根據內容回答
                    </p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            針對這段內容提出你的第一個問題吧
          </div>
        )}
      </CardContent>
      <CardFooter>
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onAsk()
          }}
        >
          {modelChoices.length > 1 && (
            <select
              aria-label="回答的模型"
              value={selectedModel ? choiceKey(selectedModel) : ''}
              disabled={isAsking}
              onChange={(e) => {
                const picked = modelChoices.find((choice) => choiceKey(choice) === e.target.value)
                if (picked) onSelectModel(picked)
              }}
              className="max-w-40 shrink-0 truncate rounded-md border bg-background px-2 text-xs"
            >
              {modelChoices.map((choice) => (
                <option key={choiceKey(choice)} value={choiceKey(choice)}>
                  {modelLabel(choice)}
                </option>
              ))}
            </select>
          )}
          {webSearchAvailable && (
            <Button
              type="button"
              variant={webSearch ? 'secondary' : 'ghost'}
              aria-label="查網路"
              aria-pressed={webSearch}
              title={webSearch ? '查網路：開（這一題也會搜尋網路）' : '查網路：關（只根據這段內容回答）'}
              onClick={() => onWebSearchChange(!webSearch)}
              className={cn('shrink-0 text-muted-foreground', webSearch && 'text-primary')}
            >
              <Globe className="size-4" />
              <span className="hidden sm:inline">查網路</span>
            </Button>
          )}
          <Input
            value={questionInput}
            onChange={(e) => onQuestionInputChange(e.target.value)}
            placeholder="針對這個內容提問..."
            disabled={isAsking}
          />
          <Button type="submit" disabled={isAsking || !questionInput.trim()}>
            {isAsking ? <Loader2Icon className="size-4 animate-spin" /> : '問'}
          </Button>
        </form>
      </CardFooter>
    </Card>
  )
}
