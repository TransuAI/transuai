import { AlertCircle, Loader2Icon, MessageCircle } from 'lucide-react'
import { modelLabel } from '@/lib/providers'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ModelChoice } from '@/types/api'

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
                  <p className="text-sm font-medium">{entry.question}</p>
                  {entry.answer && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                      {entry.answer}
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
