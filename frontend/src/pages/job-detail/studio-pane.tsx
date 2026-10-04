import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react'
import { ArrowLeft, ChartBarBig, FileText, ClipboardList, Gauge, GraduationCap, History, List, Loader2Icon, NotebookPen, PanelRightClose, RefreshCw, Sparkles, type LucideIcon } from 'lucide-react'
import type { NotesActions } from '@/hooks/use-notes'
import type { SpeakerInsightsActions } from '@/hooks/use-speaker-insights'
import type { OutputsActions } from '@/hooks/use-outputs'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/media'
import { formatCount, formatMinutes } from '@/lib/usage-format'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { NotesSection, type NoteToOpen } from '@/pages/job-detail/notes-section'
import { PostMeetingSection } from '@/pages/job-detail/post-meeting-section'
import { QuizSection } from '@/pages/job-detail/quiz-section'
import { SpeakerStatsSection } from '@/pages/job-detail/speaker-stats-section'
import { OutputsSection } from '@/pages/job-detail/outputs-section'
import { computeSpeakerStats, speakerStatsStatus } from '@/lib/speaker-stats'
import { UsageSection } from '@/pages/job-detail/usage-section'
import { cn } from '@/lib/utils'
import type { Chapter, ConfirmedProposal, JobUsage, PostMeeting, Quiz, Summary, Transcript } from '@/types/api'

/** A Studio tool; the pane shows either the tiles of all tools (none picked) or one tool. */
export type StudioTool = 'summary' | 'chapters' | 'notes' | 'quiz' | 'outputs' | 'speaker-stats' | 'post-meeting' | 'usage'

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
  speakerInsights: SpeakerInsightsActions
  outputs: OutputsActions
  /** The uploaded file's name: what downloaded outputs are named after. */
  fileName: string
  postMeeting: PostMeeting | null
  onStartPostMeeting: () => void
  isStartingPostMeeting: boolean
  onExecuteProposals: (runId: string, proposals: ConfirmedProposal[]) => void
  onRetryProposal: (runId: string, proposalId: string) => void
  isExecutingProposals: boolean
  notes: NotesActions
  /** Where playback is now, for adding a note there; null without a player. */
  currentTime: () => number | null
  noteToOpen: NoteToOpen | null
  onNoteOpened: () => void
  /** The tool on show; null shows the tiles. Kept by the workspace so it survives the Sheet closing. */
  tool: StudioTool | null
  onToolChange: (tool: StudioTool | null) => void
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
  speakerInsights,
  outputs,
  fileName,
  postMeeting,
  onStartPostMeeting,
  isStartingPostMeeting,
  onExecuteProposals,
  onRetryProposal,
  isExecutingProposals,
  notes,
  currentTime,
  noteToOpen,
  onNoteOpened,
  tool,
  onToolChange,
  onCollapse,
  className,
}: StudioPaneProps) {
  // Opening a tool moves the focus to its back button; going back returns it to the tool's tile.
  const paneRef = useRef<HTMLDivElement>(null)
  const lastToolRef = useRef(tool)
  useEffect(() => {
    const previous = lastToolRef.current
    lastToolRef.current = tool
    if (previous === tool) return
    const target = tool
      ? paneRef.current?.querySelector<HTMLElement>('[data-studio-back]')
      : paneRef.current?.querySelector<HTMLElement>(`[data-studio-tool="${previous}"]`)
    target?.focus()
  }, [tool])

  const staleNotice = (isStale || isRegenerating) && (
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
  )

  // 講者數據: null with fewer than two speakers, and then there's no tile for it.
  const speakerStats = useMemo(
    () => (transcript ? computeSpeakerStats(transcript.segments, transcript.speakers) : null),
    [transcript],
  )

  // Speaker edits can leave a single speaker while 講者數據 is open: there's nothing to show any more.
  useEffect(() => {
    if (tool === 'speaker-stats' && !speakerStats) onToolChange(null)
  }, [tool, speakerStats, onToolChange])

  const shown = tool ? TOOLS[tool] : null
  const pendingProposals =
    postMeeting?.latestRun?.proposals.filter((proposal) => proposal.status === 'PROPOSED').length ?? 0

  return (
    <Card ref={paneRef} className={cn('flex h-full min-h-0 flex-col gap-0 py-0', className)}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        {shown ? (
          <>
            <Button
              data-studio-back=""
              size="icon-sm"
              variant="ghost"
              aria-label="返回 Studio"
              title="返回 Studio"
              onClick={() => onToolChange(null)}
              className="-ml-1.5"
            >
              <ArrowLeft />
            </Button>
            <h2 className="flex-1 truncate text-sm font-medium">{shown.title}</h2>
          </>
        ) : (
          <>
            <Sparkles className="size-4 text-primary" />
            <h2 className="flex-1 text-sm font-medium">Studio</h2>
          </>
        )}
        {onCollapse && (
          <Button size="icon-sm" variant="ghost" aria-label="收合 Studio" title="收合 Studio" onClick={onCollapse} className="-mr-1.5">
            <PanelRightClose />
          </Button>
        )}
      </div>
      {/* Keyed on the tool so each one opens scrolled to its top. */}
      <ScrollArea key={tool ?? 'tiles'} className="min-h-0 flex-1">
        {/* A tool's own heading repeats the one in the header above: kept for screen readers only. */}
        <div className="flex flex-col gap-4 p-4 [&>section>h3:first-child]:sr-only">
          {tool === null && (
            <>
              {staleNotice}
              <ul aria-label="Studio 功能" className="grid grid-cols-2 gap-2">
                <ToolTile tool="summary" onOpen={onToolChange} attention={isStale}>
                  {summary ? summary.summaryText : '尚無摘要'}
                </ToolTile>
                <ToolTile tool="chapters" onOpen={onToolChange} attention={isStale}>
                  {chapters.length > 0 ? `${chapters.length} 個章節` : '尚無章節'}
                </ToolTile>
                <ToolTile tool="notes" onOpen={onToolChange}>
                  {notes.notes.length > 0 ? `${notes.notes.length} 則筆記` : '還沒有筆記'}
                </ToolTile>
                <ToolTile tool="quiz" onOpen={onToolChange} attention={quizzes.some((quiz) => quiz.status === 'GENERATING')}>
                  {quizzes.length === 0
                    ? '還沒有測驗'
                    : quizzes.some((quiz) => quiz.status === 'GENERATING')
                      ? '產生中…'
                      : `${quizzes.length} 份測驗`}
                </ToolTile>
                <ToolTile tool="outputs" onOpen={onToolChange} attention={outputs.outputs.some((o) => o.status === 'GENERATING')}>
                  {outputsStatus(outputs)}
                </ToolTile>
                {speakerStats && (
                  <ToolTile tool="speaker-stats" onOpen={onToolChange}>
                    {speakerStatsStatus(speakerStats)}
                  </ToolTile>
                )}
                <ToolTile
                  tool="post-meeting"
                  onOpen={onToolChange}
                  attention={postMeeting?.latestRun?.status === 'RUNNING' || pendingProposals > 0}
                >
                  {postMeetingStatus(postMeeting, pendingProposals)}
                </ToolTile>
                <ToolTile tool="usage" onOpen={onToolChange}>
                  {usageStatus(usage)}
                </ToolTile>
              </ul>
            </>
          )}

          {tool === 'summary' && (
            <>
              {staleNotice}
              <section className="flex flex-col gap-2">
                <h3>AI 摘要</h3>
                {summary ? (
                  <>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">{summary.summaryText}</p>
                    {summary.model && <p className="text-xs text-muted-foreground/80">由 {summary.model} 產生</p>}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">尚無摘要</p>
                )}
              </section>
            </>
          )}

          {tool === 'chapters' && (
            <>
              {staleNotice}
              <section className="flex flex-col gap-2">
                <h3>章節</h3>
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
            </>
          )}

          {tool === 'quiz' && (
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
          )}

          {tool === 'outputs' && <OutputsSection outputs={outputs} fileName={fileName} transcript={transcript} />}

          {tool === 'speaker-stats' && speakerStats && transcript && (
            <SpeakerStatsSection
              stats={speakerStats}
              transcript={transcript}
              insights={speakerInsights}
              onSeek={onSeek}
              mediaAvailable={mediaAvailable}
            />
          )}

          {tool === 'post-meeting' && (
            <PostMeetingSection
              postMeeting={postMeeting}
              onStart={onStartPostMeeting}
              isStarting={isStartingPostMeeting}
              onExecute={onExecuteProposals}
              onRetry={onRetryProposal}
              isExecuting={isExecutingProposals}
            />
          )}

          {tool === 'notes' && (
            <NotesSection
              notes={notes}
              onSeek={onSeek}
              mediaAvailable={mediaAvailable}
              currentTime={currentTime}
              noteToOpen={noteToOpen}
              onNoteOpened={onNoteOpened}
            />
          )}

          {tool === 'usage' && <UsageSection usage={usage} />}
        </div>
      </ScrollArea>
    </Card>
  )
}

const TOOLS: Record<StudioTool, { title: string; icon: LucideIcon }> = {
  summary: { title: 'AI 摘要', icon: Sparkles },
  chapters: { title: '章節', icon: List },
  notes: { title: '筆記', icon: NotebookPen },
  quiz: { title: '測驗', icon: GraduationCap },
  outputs: { title: '多格式輸出', icon: FileText },
  'speaker-stats': { title: '講者數據', icon: ChartBarBig },
  'post-meeting': { title: '會後處理', icon: ClipboardList },
  usage: { title: '用量', icon: Gauge },
}

function outputsStatus({ outputs }: OutputsActions): string {
  if (outputs.some((output) => output.status === 'GENERATING')) return '產生中…'
  const done = outputs.filter((output) => output.status === 'COMPLETED').length
  return done > 0 ? `${done} 份` : 'Podcast 介紹等文件'
}

function usageStatus(usage: JobUsage | null): string {
  if (!usage || usage.records.length === 0) return '尚無紀錄'
  const tokens = usage.totals.inputTokens + usage.totals.outputTokens
  const searches = usage.totals.webSearches ?? 0
  const parts = [
    tokens > 0 && `${formatCount(tokens)} tokens`,
    usage.totals.audioSeconds > 0 && `轉錄 ${formatMinutes(usage.totals.audioSeconds)}`,
    searches > 0 && `網路搜尋 ${searches} 次`,
  ]
  return parts.filter(Boolean).join(' · ') || `${usage.records.length} 次呼叫`
}

function postMeetingStatus(postMeeting: PostMeeting | null, pendingProposals: number): string {
  if (!postMeeting) return ''
  const run = postMeeting.latestRun
  if (!run) return postMeeting.available ? '還沒執行' : '目前無法使用'
  switch (run.status) {
    case 'RUNNING':
      return '執行中…'
    case 'FAILED':
      return '上次執行失敗'
    default:
      return pendingProposals > 0 ? `${pendingProposals} 個提案待確認` : '已完成'
  }
}

// One tool on the Studio's front page: its name, and a line on where it stands (the summary's opening, how many
// chapters, …). `attention` marks one worth a look: out of date, in progress, or waiting on the user.
function ToolTile({
  tool,
  onOpen,
  attention = false,
  children,
}: {
  tool: StudioTool
  onOpen: (tool: StudioTool) => void
  attention?: boolean
  children: ReactNode
}) {
  const { title, icon: Icon } = TOOLS[tool]
  const titleId = useId()
  const statusId = useId()
  return (
    <li className="contents">
      <button
        type="button"
        data-studio-tool={tool}
        aria-labelledby={titleId}
        aria-describedby={statusId}
        onClick={() => onOpen(tool)}
        className="relative flex min-h-24 flex-col items-start gap-2 rounded-lg border bg-background p-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {attention && <span aria-hidden className="absolute top-3 right-3 size-2 rounded-full bg-primary" />}
        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 self-stretch">
          <span id={titleId} className="text-sm font-medium">
            {title}
          </span>
          <span id={statusId} className="line-clamp-2 text-xs text-muted-foreground">
            {children}
          </span>
        </span>
      </button>
    </li>
  )
}
