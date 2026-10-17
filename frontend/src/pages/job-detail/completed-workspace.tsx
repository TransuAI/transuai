import { useCallback, useEffect, useRef, useState } from 'react'
import type { DecisionsActions } from '@/hooks/use-decisions'
import type { FactCheckActions } from '@/hooks/use-fact-check'
import type { SpeakerInsightsActions } from '@/hooks/use-speaker-insights'
import type { OutputsActions } from '@/hooks/use-outputs'
import type { TranslationsActions } from '@/hooks/use-translations'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookmarkPlus, FileText, PanelLeftOpen, PanelRightOpen, Sparkles, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { AutoFollow } from '@/hooks/use-auto-follow'
import { useMediaQuery } from '@/hooks/use-media-query'
import { answerNoteText, noteTime } from '@/lib/notes'
import { isSummaryStale } from '@/lib/staleness'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SourcePane } from '@/pages/job-detail/source-pane'
import type { SpeakerSuggestionActions } from '@/pages/job-detail/speaker-panel'
import type { NotesActions } from '@/hooks/use-notes'
import { ChatPane, type QaEntry } from '@/pages/job-detail/chat-pane'
import type { NoteToOpen } from '@/pages/job-detail/notes-section'
import { ExportMenu } from '@/pages/job-detail/export-menu'
import { shownSpeakerOf } from '@/lib/speakers'
import { MiniPlayer } from '@/pages/job-detail/mini-player'
import { StudioPane, type StudioTool } from '@/pages/job-detail/studio-pane'
import { cn } from '@/lib/utils'

const NO_CLAIMS: Claim[] = []
import type { Chapter, Claim, ConfirmedProposal, Job, JobUpdate, JobUsage, ModelChoice, PostMeeting, Quiz, SpeakerAssignment, Summary, Transcript } from '@/types/api'

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
  /** 查網路: whether questions can search the web at all, and whether the next one will. */
  webSearchAvailable: boolean
  webSearch: boolean
  /** Searches left this month; null when unknown. */
  webSearchesLeft: number | null
  onWebSearchChange: (on: boolean) => void
  onSeek: (seconds: number) => void
  onSaveSegmentText: (segmentId: string, text: string) => Promise<void>
  onRenameSpeaker: (label: string, name: string) => Promise<void>
  /** 改標題／類型; rejects when saving fails. */
  onUpdateJob: (update: JobUpdate) => Promise<void>
  speakerSuggestions: SpeakerSuggestionActions
  onAssignSpeaker: (segmentId: string, assignment: SpeakerAssignment) => Promise<void>
  onRegenerateSummary: () => void
  isRegeneratingSummary: boolean
  isRequestingRegeneration: boolean
  usage: JobUsage | null
  quizzes: Quiz[]
  onRequestQuiz: (questionCount: number) => void
  isRequestingQuiz: boolean
  onQuizAttempted: () => void
  speakerInsights: SpeakerInsightsActions
  decisions: DecisionsActions
  factCheck: FactCheckActions
  outputs: OutputsActions
  translations: TranslationsActions
  postMeeting: PostMeeting | null
  onStartPostMeeting: () => void
  isStartingPostMeeting: boolean
  onExecuteProposals: (runId: string, proposals: ConfirmedProposal[]) => void
  onRetryProposal: (runId: string, proposalId: string) => void
  isExecutingProposals: boolean
  notes: NotesActions
  /** Where playback is now; null without a player. */
  currentTime: () => number | null
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

// The N key adds a note — but not while the user is typing, holding a modifier (shortcuts of the browser's own), in a
// menu (N picks an item there) or in a dialog (whatever is behind it isn't what they're looking at).
function isAddNoteKey(event: KeyboardEvent): boolean {
  if (event.key !== 'n' && event.key !== 'N') return false
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing) return false
  const target = event.target
  if (!(target instanceof HTMLElement)) return true
  if (target.isContentEditable || target.closest('input, textarea, select, [role="dialog"], [role="menu"], [role="listbox"]')) return false
  return true
}

// A folded side pane on desktop: a slim strip that unfolds it again (its name is in the tooltip).
function CollapsedRail({ label, icon: Icon, expandIcon: ExpandIcon, onExpand }: {
  label: string
  icon: LucideIcon
  expandIcon: LucideIcon
  onExpand: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onExpand}
      className="flex h-full flex-col items-center gap-3 rounded-xl bg-card py-4 text-muted-foreground ring-1 ring-foreground/10 transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ExpandIcon className="size-4" />
      <Icon className="size-4" />
    </button>
  )
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
  webSearchAvailable,
  webSearch,
  webSearchesLeft,
  onWebSearchChange,
  onSeek,
  onSaveSegmentText,
  onRenameSpeaker,
  onUpdateJob,
  speakerSuggestions,
  onAssignSpeaker,
  onRegenerateSummary,
  isRegeneratingSummary,
  isRequestingRegeneration,
  usage,
  quizzes,
  onRequestQuiz,
  isRequestingQuiz,
  onQuizAttempted,
  speakerInsights,
  decisions,
  factCheck,
  outputs,
  translations,
  postMeeting,
  onStartPostMeeting,
  isStartingPostMeeting,
  onExecuteProposals,
  onRetryProposal,
  isExecutingProposals,
  notes,
  currentTime,
  modelChoices,
  selectedModel,
  onSelectModel,
  setMediaRef,
}: CompletedWorkspaceProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [lastIsDesktop, setLastIsDesktop] = useState(isDesktop)
  // Desktop only: a folded pane stays mounted (hidden) so the player in the Source pane keeps playing.
  const [sourceCollapsed, setSourceCollapsed] = useState(false)
  const [studioCollapsed, setStudioCollapsed] = useState(false)
  // The Studio tool on show (null: the tiles), shared by the grid and the Sheet so closing either keeps the place.
  const [studioTool, setStudioTool] = useState<StudioTool | null>(null)
  const [noteToOpen, setNoteToOpen] = useState<NoteToOpen | null>(null)

  if (isDesktop !== lastIsDesktop) {
    setLastIsDesktop(isDesktop)
    if (isDesktop) {
      setSourceOpen(false)
      setStudioOpen(false)
    }
  }

  // A note added or picked anywhere opens in the Studio's 筆記 — unfolded on desktop, its Sheet on a phone.
  const openNote = (noteId: string, edit: boolean) => {
    setStudioTool('notes')
    setStudioCollapsed(false)
    if (!isDesktop) {
      setSourceOpen(false)
      setStudioOpen(true)
    }
    setNoteToOpen({ noteId, edit })
  }
  const onNoteOpened = useCallback(() => setNoteToOpen(null), [])

  // A decision picked in 講者數據, or in the address (the 決策 page links to /jobs/…?decision=…), opens in the Studio's 決策.
  const [decisionToOpen, setDecisionToOpen] = useState<string | null>(null)
  const openDecision = (decisionId: string | null) => {
    setStudioTool('decisions')
    setStudioCollapsed(false)
    if (!isDesktop) {
      setSourceOpen(false)
      setStudioOpen(true)
    }
    setDecisionToOpen(decisionId)
  }
  const onDecisionOpened = useCallback(() => setDecisionToOpen(null), [])
  // A claim marked on the transcript opens in the Studio's 事實查核.
  const [claimToOpen, setClaimToOpen] = useState<string | null>(null)
  const openClaim = (claimId: string) => {
    setStudioTool('fact-check')
    setStudioCollapsed(false)
    if (!isDesktop) {
      setSourceOpen(false)
      setStudioOpen(true)
    }
    setClaimToOpen(claimId)
  }
  const onClaimOpened = useCallback(() => setClaimToOpen(null), [])
  const [searchParams] = useSearchParams()
  const decisionInAddress = searchParams.get('decision')
  const [openedFromAddress, setOpenedFromAddress] = useState<string | null>(null)
  if (decisionInAddress && decisionInAddress !== openedFromAddress) {
    setOpenedFromAddress(decisionInAddress)
    openDecision(decisionInAddress)
  }
  // A bookmark first (saved even if nothing gets typed), then opened for writing.
  const addNoteAt = async (seconds: number) => {
    try {
      const note = await notes.add({ timeSeconds: noteTime(seconds) })
      openNote(note.noteId, true)
    } catch {
      toast.error('筆記沒有存到')
    }
  }
  const addNoteNow = () => {
    const seconds = currentTime()
    if (seconds !== null) void addNoteAt(seconds)
  }
  const saveAnswerAsNote = async (entry: QaEntry) => {
    const note = await notes.add({
      text: answerNoteText(entry.answer, entry.webSources?.length ?? 0),
      timeSeconds: entry.sourceTimestamps[0],
      source: 'qa',
    })
    toast.success('已存成筆記', { action: { label: '查看', onClick: () => openNote(note.noteId, false) } })
  }

  const addNoteNowRef = useRef(addNoteNow)
  useEffect(() => {
    addNoteNowRef.current = addNoteNow
  })
  useEffect(() => {
    if (!mediaAvailable) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAddNoteKey(event)) return
      event.preventDefault()
      addNoteNowRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mediaAvailable])

  const sourcePaneProps = {
    translations,
    job,
    transcript,
    currentSegmentIndex,
    autoFollow,
    mediaAvailable,
    onSeek,
    onSaveSegmentText,
    onRenameSpeaker,
    onUpdateJob,
    speakerSuggestions,
    onAssignSpeaker,
    notes: notes.notes,
    onAddNoteAt: (seconds: number) => void addNoteAt(seconds),
    onOpenNote: (noteId: string) => openNote(noteId, false),
    claims: factCheck.factCheck?.claims ?? NO_CLAIMS,
    onOpenClaim: openClaim,
  }
  const desktopPlayer = mediaUrl && (
    <div className="flex flex-col gap-1.5">
      {job.fileType === 'VIDEO' ? (
        <video ref={setMediaRef} src={mediaUrl} controls className="w-full rounded-lg bg-black" />
      ) : (
        <audio ref={setMediaRef} src={mediaUrl} controls className="w-full" />
      )}
      <Button
        size="xs"
        variant="ghost"
        aria-keyshortcuts="N"
        title="在目前播放的時間加筆記（N）"
        onClick={addNoteNow}
        className="self-end text-muted-foreground"
      >
        <BookmarkPlus />
        加筆記
        <kbd aria-hidden className="rounded border px-1 font-sans text-[10px] leading-4">
          N
        </kbd>
      </Button>
    </div>
  )
  const renderStudioPane = (desktop: { onCollapse: () => void; className?: string } | null) => (
    <StudioPane
      tool={studioTool}
      onToolChange={setStudioTool}
      notes={notes}
      currentTime={currentTime}
      noteToOpen={noteToOpen}
      onNoteOpened={onNoteOpened}
      onOpenDecision={openDecision}
      decisionToOpen={decisionToOpen}
      onDecisionOpened={onDecisionOpened}
      onCollapse={desktop?.onCollapse}
      className={desktop?.className}
      summary={summary}
      chapters={chapters}
      onSeek={onSeek}
      mediaAvailable={mediaAvailable}
      isStale={isSummaryStale(summary, transcript)}
      onRegenerate={onRegenerateSummary}
      isRegenerating={isRegeneratingSummary}
      isRequestingRegeneration={isRequestingRegeneration}
      usage={usage}
      quizzes={quizzes}
      transcript={transcript}
      onRequestQuiz={onRequestQuiz}
      isRequestingQuiz={isRequestingQuiz}
      onQuizAttempted={onQuizAttempted}
      speakerInsights={speakerInsights}
      decisions={decisions}
      factCheck={factCheck}
      webSearchAvailable={webSearchAvailable}
      webSearchesLeft={webSearchesLeft}
      claimToOpen={claimToOpen}
      onClaimOpened={onClaimOpened}
      outputs={outputs}
      fileName={job.fileName}
      jobTitle={job.title ?? null}
      postMeeting={postMeeting}
      onStartPostMeeting={onStartPostMeeting}
      isStartingPostMeeting={isStartingPostMeeting}
      onExecuteProposals={onExecuteProposals}
      onRetryProposal={onRetryProposal}
      isExecutingProposals={isExecutingProposals}
      jobId={job.jobId}
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
      webSearchAvailable={webSearchAvailable}
      webSearch={webSearch}
      webSearchesLeft={webSearchesLeft}
      onWebSearchChange={onWebSearchChange}
      onSeek={onSeek}
      mediaAvailable={mediaAvailable}
      modelChoices={modelChoices}
      selectedModel={selectedModel}
      onSelectModel={onSelectModel}
      onSaveAsNote={saveAnswerAsNote}
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
          <ExportMenu
            source={{ job, transcript, summary, chapters, qaHistory, notes: notes.notes, speakerInsights: speakerInsights.insights, decisions: decisions.decisions?.decisions ?? [] }}
            quizzes={quizzes}
            translations={translations.translations}
          />
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
        // The side panes widen with the screen; a folded one leaves a 3rem rail and gives its room to 問答.
        <div
          className={cn(
            'grid min-h-0 flex-1 grid-cols-[var(--source-width)_minmax(0,1fr)_var(--studio-width)] gap-4',
            sourceCollapsed
              ? '[--source-width:3rem]'
              : '[--source-width:20rem] xl:[--source-width:26rem] 2xl:[--source-width:30rem]',
            studioCollapsed
              ? '[--studio-width:3rem]'
              : '[--studio-width:18rem] xl:[--studio-width:22rem] 2xl:[--studio-width:26rem]',
          )}
        >
          {sourceCollapsed && (
            <CollapsedRail label="展開來源" icon={FileText} expandIcon={PanelLeftOpen} onExpand={() => setSourceCollapsed(false)} />
          )}
          <SourcePane
            {...sourcePaneProps}
            player={desktopPlayer}
            onCollapse={() => setSourceCollapsed(true)}
            className={cn(sourceCollapsed && 'hidden')}
          />
          {chatPane}
          {studioCollapsed && (
            <CollapsedRail label="展開 Studio" icon={Sparkles} expandIcon={PanelRightOpen} onExpand={() => setStudioCollapsed(false)} />
          )}
          {renderStudioPane({ onCollapse: () => setStudioCollapsed(true), className: cn(studioCollapsed && 'hidden') })}
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
              onAddNote={addNoteNow}
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
          {renderStudioPane(null)}
        </SheetContent>
      </Sheet>
    </div>
  )
}
