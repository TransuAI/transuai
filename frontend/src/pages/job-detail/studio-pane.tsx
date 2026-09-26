import { History, List, Loader2Icon, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/media'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { UsageSection } from '@/pages/job-detail/usage-section'
import type { Chapter, JobUsage, Summary } from '@/types/api'

interface StudioPaneProps {
  summary: Summary | null
  chapters: Chapter[]
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  /** The summary and chapters predate an edit of the transcript (過時). */
  isStale: boolean
  onRegenerate: () => void
  /** A regeneration is running in the background; the old content stays visible meanwhile. */
  isRegenerating: boolean
  /** The regenerate request itself is still on its way. */
  isRequestingRegeneration: boolean
  usage: JobUsage | null
}

export function StudioPane({
  summary,
  chapters,
  onSeek,
  mediaAvailable,
  isStale,
  onRegenerate,
  isRegenerating,
  isRequestingRegeneration,
  usage,
}: StudioPaneProps) {
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
            {(isStale || isRegenerating) && (
              <div className="flex flex-col gap-2 rounded-md border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                {isStale && (
                  <p className="flex items-start gap-2">
                    <History className="mt-0.5 size-4 shrink-0" />
                    逐字稿已修改，摘要與章節可能過時
                  </p>
                )}
                {isRegenerating ? (
                  <p className="flex items-center gap-2" aria-live="polite">
                    <Loader2Icon className="size-4 animate-spin" />
                    重新產生中…
                  </p>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    disabled={isRequestingRegeneration}
                    onClick={onRegenerate}
                  >
                    <RefreshCw className="size-4" />
                    重新產生摘要與章節
                  </Button>
                )}
              </div>
            )}
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4" />
                AI 摘要
              </h3>
              {summary ? (
                <>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {summary.summaryText}
                  </p>
                  {summary.model && <p className="text-xs text-muted-foreground/80">由 {summary.model} 產生</p>}
                </>
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

            <UsageSection usage={usage} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
