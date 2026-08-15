import { AlertCircle, MessageCircle } from 'lucide-react'
import { formatDuration } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

export type QaEntryStatus = 'streaming' | 'done' | 'error'

export interface QaEntry {
  id: string
  question: string
  answer: string
  sourceTimestamps: number[]
  status: QaEntryStatus
}

interface ChatPaneProps {
  qaHistory: QaEntry[]
  questionInput: string
  onQuestionInputChange: (value: string) => void
  isAsking: boolean
  onAsk: () => void
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}

export function ChatPane({
  qaHistory,
  questionInput,
  onQuestionInputChange,
  isAsking,
  onAsk,
  onSeek,
  mediaAvailable,
}: ChatPaneProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4" />
          問答
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pt-4">
        {qaHistory.length > 0 ? (
          <ScrollArea className="h-full pr-4">
            <div className="flex flex-col gap-4">
              {qaHistory.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
                  <p className="text-sm font-medium">{entry.question}</p>
                  {entry.answer ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                      {entry.answer}
                    </p>
                  ) : entry.status === 'streaming' ? (
                    <p className="text-sm text-muted-foreground">思考中...</p>
                  ) : null}
                  {entry.status === 'error' && (
                    <p className="flex items-center gap-1.5 text-sm text-destructive">
                      <AlertCircle className="size-3.5" />
                      回答失敗，請重新提問
                    </p>
                  )}
                  {entry.sourceTimestamps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {entry.sourceTimestamps.map((ts, j) => (
                        <button
                          key={j}
                          type="button"
                          disabled={!mediaAvailable}
                          onClick={() => onSeek(ts)}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
                        >
                          {formatDuration(ts)}
                        </button>
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
          <Input
            value={questionInput}
            onChange={(e) => onQuestionInputChange(e.target.value)}
            placeholder="針對這個內容提問..."
            disabled={isAsking}
          />
          <Button type="submit" disabled={isAsking || !questionInput.trim()}>
            {isAsking ? '思考中...' : '問'}
          </Button>
        </form>
      </CardFooter>
    </Card>
  )
}
