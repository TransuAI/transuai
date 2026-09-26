import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileText, Sparkles } from 'lucide-react'
import type { AutoFollow } from '@/hooks/use-auto-follow'
import { useMediaQuery } from '@/hooks/use-media-query'
import { isSummaryStale } from '@/lib/summary-staleness'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SourcePane } from '@/pages/job-detail/source-pane'
import { ChatPane, type QaEntry } from '@/pages/job-detail/chat-pane'
import { ExportMenu } from '@/pages/job-detail/export-menu'
import { shownSpeakerOf } from '@/lib/speakers'
import { MiniPlayer } from '@/pages/job-detail/mini-player'
import { StudioPane } from '@/pages/job-detail/studio-pane'
import type { Chapter, Job, JobUsage, ModelChoice, SpeakerAssignment, Summary, Transcript } from '@/types/api'

interface CompletedWorkspaceProps {
  job: Job
  mediaUrl: string | undefined
  mediaAvailable: boolean
  transcript: Transcript | null
  currentSegmentIndex: number | null
  autoFollow: AutoFollow
  summary: Summary | null
  chapters: Chapter[]
  qaHistory: QaEntry[]
  isLoadingHistory: boolean
  questionInput: string
  onQuestionInputChange: (value: string) => void
  isAsking: boolean
  onAsk: () => void
  onSeek: (seconds: number) => void
  onSaveSegmentText: (segmentId: string, text: string) => Promise<void>
  onRenameSpeaker: (label: string, name: string) => Promise<void>
  onAssignSpeaker: (segmentId: string, assignment: SpeakerAssignment) => Promise<void>
  onRegenerateSummary: () => void
  isRegeneratingSummary: boolean
  isRequestingRegeneration: boolean
  usage: JobUsage | null
  modelChoices: ModelChoice[]
  selectedModel: ModelChoice | null
  onSelectModel: (model: ModelChoice) => void
  setMediaRef: (el: HTMLMediaElement | null) => void
}

// Some controls give Esc a meaning of their own and mark themselves with data-consumes-escape:
// the search box while it has a query (Esc clears it), a segment editor (Esc cancels the edit).
// Only an Esc from anywhere else closes the Sheet. Radix handles Escape on the document in the
// capture phase, i.e. before those controls see it, so the Sheet has to opt out here.
function keepOpenForControlsThatConsumeEscape(event: KeyboardEvent) {
  if (event.target instanceof Element && event.target.closest('[data-consumes-escape]')) event.preventDefault()
}

// Radix focuses the first focusable element when a Sheet opens — for the Source Sheet that's
// the search box, which on a phone pops the on-screen keyboard over the transcript. Focus the
// Sheet itself instead (still inside the focus trap, still announced as a dialog).
function focusSheetInsteadOfSearch(event: Event) {
  event.preventDefault()
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
}

// There is only ever one <audio>/<video> element in the tree — two would race to own the
// page's media element. On desktop it lives in the Source pane of the grid; on narrow
// viewports it lives in the MiniPlayer under the Chat pane, and the Source Sheet renders
// the transcript without a player, so closing the Sheet doesn't stop playback. The page
// restores the playback position when a layout switch remounts the element. The Sheets are
// force-closed the moment isDesktop flips, computed during render (not a useEffect) so the
// close happens in the same commit as the layout switch.
export function CompletedWorkspace({
  job,
  mediaUrl,
  mediaAvailable,
  transcript,
  currentSegmentIndex,
  autoFollow,
  summary,
  chapters,
  qaHistory,
  isLoadingHistory,
  questionInput,
  onQuestionInputChange,
  isAsking,
  onAsk,
  onSeek,
  onSaveSegmentText,
  onRenameSpeaker,
  onAssignSpeaker,
  onRegenerateSummary,
  isRegeneratingSummary,
  isRequestingRegeneration,
  usage,
  modelChoices,
  selectedModel,
  onSelectModel,
  setMediaRef,
}: CompletedWorkspaceProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [lastIsDesktop, setLastIsDesktop] = useState(isDesktop)

  if (isDesktop !== lastIsDesktop) {
    setLastIsDesktop(isDesktop)
    if (isDesktop) {
      setSourceOpen(false)
      setStudioOpen(false)
    }
  }

  const sourcePaneProps = {
    job,
    transcript,
    currentSegmentIndex,
    autoFollow,
    mediaAvailable,
    onSeek,
    onSaveSegmentText,
    onRenameSpeaker,
    onAssignSpeaker,
  }
  const desktopPlayer =
    mediaUrl &&
    (job.fileType === 'VIDEO' ? (
      <video ref={setMediaRef} src={mediaUrl} controls className="w-full rounded-md" />
    ) : (
      <audio ref={setMediaRef} src={mediaUrl} controls className="w-full" />
    ))
  const studioPane = (
    <StudioPane
      summary={summary}
      chapters={chapters}
      onSeek={onSeek}
      mediaAvailable={mediaAvailable}
      isStale={isSummaryStale(summary, transcript)}
      onRegenerate={onRegenerateSummary}
      isRegenerating={isRegeneratingSummary}
      isRequestingRegeneration={isRequestingRegeneration}
      usage={usage}
    />
  )
  const currentSegment = currentSegmentIndex !== null ? transcript?.segments[currentSegmentIndex] : undefined

  const chatPane = (
    <ChatPane
      qaHistory={qaHistory}
      isLoadingHistory={isLoadingHistory}
      questionInput={questionInput}
      onQuestionInputChange={onQuestionInputChange}
      isAsking={isAsking}
      onAsk={onAsk}
      onSeek={onSeek}
      mediaAvailable={mediaAvailable}
      modelChoices={modelChoices}
      selectedModel={selectedModel}
      onSelectModel={onSelectModel}
    />
  )

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[32rem] flex-col gap-4 md:h-[calc(100vh-3rem)]">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="w-fit -ml-2">
          <Link to="/jobs">
            <ArrowLeft className="size-4" />
            返回列表
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <ExportMenu source={{ job, transcript, summary, chapters, qaHistory }} />
          <div className="flex items-center gap-2 lg:hidden">
            <Button variant="outline" size="sm" onClick={() => setSourceOpen(true)}>
              <FileText className="size-4" />
              來源
            </Button>
            <Button variant="outline" size="sm" onClick={() => setStudioOpen(true)}>
              <Sparkles className="size-4" />
              Studio
            </Button>
          </div>
        </div>
      </div>

      {isDesktop ? (
        <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)_20rem] gap-4">
          <SourcePane {...sourcePaneProps} player={desktopPlayer} />
          {chatPane}
          {studioPane}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1">{chatPane}</div>
          {mediaUrl && (
            <MiniPlayer
              fileType={job.fileType}
              mediaUrl={mediaUrl}
              fallbackDuration={job.durationSeconds}
              setMediaRef={setMediaRef}
              currentSegmentText={currentSegment?.text ?? null}
              currentSpeaker={
                transcript && currentSegment ? shownSpeakerOf(currentSegment, transcript.segments, transcript.speakers) : null
              }
            />
          )}
        </div>
      )}

      <Sheet open={sourceOpen} onOpenChange={setSourceOpen}>
        <SheetContent
          side="left"
          className="w-full gap-0 p-0 sm:max-w-md"
          onEscapeKeyDown={keepOpenForControlsThatConsumeEscape}
          onOpenAutoFocus={focusSheetInsteadOfSearch}
        >
          <SheetTitle className="sr-only">Source</SheetTitle>
          {/* Never a player here: during the Sheet's exit animation after a switch to desktop it
              would be a second media element next to the grid's. */}
          <SourcePane {...sourcePaneProps} />
        </SheetContent>
      </Sheet>

      <Sheet open={studioOpen} onOpenChange={setStudioOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetTitle className="sr-only">Studio</SheetTitle>
          {studioPane}
        </SheetContent>
      </Sheet>
    </div>
  )
}
