import { List, Sparkles } from 'lucide-react'
import { formatDuration } from '@/lib/media'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Chapter, Summary } from '@/types/api'

interface StudioPaneProps {
  summary: Summary | null
  chapters: Chapter[]
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}

export function StudioPane({ summary, chapters, onSeek, mediaAvailable }: StudioPaneProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" />
          Studio
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pt-4">
        <ScrollArea className="h-full pr-4">
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4" />
                AI 摘要
              </h3>
              {summary ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {summary.summaryText}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">尚無摘要</p>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <List className="size-4" />
                章節
              </h3>
              {chapters.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {chapters.map((chapter) => (
                    <button
                      key={chapter.id}
                      type="button"
                      disabled={!mediaAvailable}
                      onClick={() => onSeek(chapter.startTime)}
                      className="flex items-center gap-3 rounded text-left text-sm enabled:hover:text-accent-foreground disabled:opacity-60"
                    >
                      <span className="h-fit shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {formatDuration(chapter.startTime)}
                      </span>
                      <span className="leading-relaxed">{chapter.title}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">尚無章節</p>
              )}
            </section>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
