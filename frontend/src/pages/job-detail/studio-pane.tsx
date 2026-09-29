import { History, List, Loader2Icon, PanelRightClose, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/media'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PostMeetingSection } from '@/pages/job-detail/post-meeting-section'
import { QuizSection } from '@/pages/job-detail/quiz-section'
import { UsageSection } from '@/pages/job-detail/usage-section'
import { cn } from '@/lib/utils'
import type { Chapter, ConfirmedProposal, JobUsage, PostMeeting, Quiz, Summary, Transcript } from '@/types/api'

interface StudioPaneProps {
  jobId: string
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
  quizzes: Quiz[]
  transcript: Transcript | null
  onRequestQuiz: (questionCount: number) => void
  isRequestingQuiz: boolean
  onQuizAttempted: () => void
  postMeeting: PostMeeting | null
  onStartPostMeeting: () => void
  isStartingPostMeeting: boolean
  onExecuteProposals: (runId: string, proposals: ConfirmedProposal[]) => void
  onRetryProposal: (runId: string, proposalId: string) => void
  isExecutingProposals: boolean
  /** Folds the pane into a rail (desktop grid only). */
  onCollapse?: () => void
  className?: string
}

export function StudioPane({
  jobId,
  summary,
  chapters,
  onSeek,
  mediaAvailable,
  isStale,
  onRegenerate,
  isRegenerating,
  isRequestingRegeneration,
  usage,
  quizzes,
  transcript,
  onRequestQuiz,
  isRequestingQuiz,
  onQuizAttempted,
  postMeeting,
  onStartPostMeeting,
  isStartingPostMeeting,
  onExecuteProposals,
  onRetryProposal,
  isExecutingProposals,
  onCollapse,
  className,
}: StudioPaneProps) {
  return (
    <Card className={cn('flex h-full min-h-0 flex-col gap-0 py-0', className)}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Sparkles className="size-4 text-primary" />
        <h2 className="flex-1 text-sm font-medium">Studio</h2>
        {onCollapse && (
          <Button size="icon-sm" variant="ghost" aria-label="收合 Studio" title="收合 Studio" onClick={onCollapse} className="-mr-1.5">
            <PanelRightClose />
          </Button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {/* Each section is set apart by a rule, so the long list reads as separate tools. */}
        <div className="flex flex-col gap-5 p-4 [&>section+section]:border-t [&>section+section]:pt-5">
          {(isStale || isRegenerating) && (
            <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
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
                  className="w-fit bg-background"
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
              <Sparkles className="size-4 text-muted-foreground" />
              AI 摘要
            </h3>
            {summary ? (
              <>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">{summary.summaryText}</p>
                {summary.model && <p className="text-xs text-muted-foreground/80">由 {summary.model} 產生</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">尚無摘要</p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <List className="size-4 text-muted-foreground" />
              章節
            </h3>
            {chapters.length > 0 ? (
              <ol className="-mx-2 flex flex-col">
                {chapters.map((chapter) => (
                  <li key={chapter.id}>
                    <button
                      type="button"
                      disabled={!mediaAvailable}
                      onClick={() => onSeek(chapter.startTime)}
                      className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
                    >
                      <span className="mt-px shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
                        {formatDuration(chapter.startTime)}
                      </span>
                      <span className="leading-relaxed">{chapter.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">尚無章節</p>
            )}
          </section>

          <QuizSection
            jobId={jobId}
            quizzes={quizzes}
            transcript={transcript}
            onRequestQuiz={onRequestQuiz}
            isRequesting={isRequestingQuiz}
            onSeek={onSeek}
            mediaAvailable={mediaAvailable}
            onAttempted={onQuizAttempted}
          />

          <PostMeetingSection
            postMeeting={postMeeting}
            onStart={onStartPostMeeting}
            isStarting={isStartingPostMeeting}
            onExecute={onExecuteProposals}
            onRetry={onRetryProposal}
            isExecuting={isExecutingProposals}
          />

          <UsageSection usage={usage} />
        </div>
      </ScrollArea>
    </Card>
  )
}
