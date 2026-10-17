import { useState, type ReactNode } from 'react'
import type { TranslationsActions } from '@/hooks/use-translations'
import { TranslationBar } from '@/pages/job-detail/translation-bar'
import { FileAudio, FileText, FileVideo, PanelLeftClose, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { CATEGORY_LABELS, jobDisplayName } from '@/lib/job-display'
import { formatBytes, formatDuration, formatShortDateTime } from '@/lib/media'
import type { AutoFollow } from '@/hooks/use-auto-follow'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NameInput } from '@/pages/job-detail/name-input'
import { SpeakerPanel, type SpeakerSuggestionActions } from '@/pages/job-detail/speaker-panel'
import { TranscriptView } from '@/pages/job-detail/transcript-view'
import { cn } from '@/lib/utils'
import type { Claim, Job, JobCategory, JobUpdate, Note, SpeakerAssignment, Transcript } from '@/types/api'

interface SourcePaneProps {
  job: Job
  /** The media element, when this copy of the pane owns it (the desktop grid); omitted in the Source Sheet. */
  player?: ReactNode
  transcript: Transcript | null
  currentSegmentIndex: number | null
  autoFollow: AutoFollow
  mediaAvailable: boolean
  onSeek: (seconds: number) => void
  onSaveSegmentText: (segmentId: string, text: string) => Promise<void>
  onRenameSpeaker: (label: string, name: string) => Promise<void>
  /** 改標題／類型; rejects when saving fails. */
  onUpdateJob: (update: JobUpdate) => Promise<void>
  speakerSuggestions: SpeakerSuggestionActions
  onAssignSpeaker: (segmentId: string, assignment: SpeakerAssignment) => Promise<void>
  /** 筆記, marked on the transcript. */
  notes: Note[]
  onAddNoteAt: (seconds: number) => void
  onOpenNote: (noteId: string) => void
  /** 事實查核's 主張, marked on the transcript; opening one shows it in the Studio. */
  claims: Claim[]
  onOpenClaim: (claimId: string) => void
  /** 譯文: what the transcript shows, and translating it. */
  translations: TranslationsActions
  /** Folds the pane into a rail (desktop grid only). */
  onCollapse?: () => void
  className?: string
}

export function SourcePane({
  job,
  player,
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
  notes,
  onAddNoteAt,
  onOpenNote,
  claims,
  onOpenClaim,
  translations,
  onCollapse,
  className,
}: SourcePaneProps) {
  const { display, texts } = translations
  const FileIcon = job.fileType === 'VIDEO' ? FileVideo : FileAudio
  return (
    <Card className={cn('flex h-full min-h-0 flex-col gap-0 py-0', className)}>
      <div className="flex flex-col border-b">
        {/* In the Source Sheet (no onCollapse) the Sheet's own close button sits top-right: leave it room. */}
        <div className={cn('flex min-h-14 items-center gap-3 py-2.5 pl-4', onCollapse ? 'pr-4' : 'pr-12')}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileIcon className="size-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <JobTitle job={job} onUpdateJob={onUpdateJob} />
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <CategorySelect category={job.category} onUpdateJob={onUpdateJob} />
              <p title={job.fileName} className="truncate tabular-nums">
                {/* With a title the file name moves down here, to match it with the file on the user's computer. */}
                {job.title && `${job.fileName} · `}
                {formatDuration(job.durationSeconds)} · {formatBytes(job.fileSizeBytes)} · {formatShortDateTime(job.createdAt)}
              </p>
            </div>
          </div>
          {onCollapse && (
            <Button size="icon-sm" variant="ghost" aria-label="收合來源" title="收合來源" onClick={onCollapse} className="-mr-1.5">
              <PanelLeftClose />
            </Button>
          )}
        </div>
        {player && <div className="px-4 pb-4">{player}</div>}
      </div>
      {transcript && (
        <div className="border-b px-4 py-3 empty:hidden">
          <SpeakerPanel
            transcript={transcript}
            onRename={onRenameSpeaker}
            suggestions={speakerSuggestions}
            onSeek={onSeek}
            mediaAvailable={mediaAvailable}
          />
        </div>
      )}
      {/* The translation bar takes what it needs; the transcript gets the rest of the pane's height, not all of it. */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-3">
        {transcript && <TranslationBar translations={translations} />}
        {transcript ? (
          <div className="min-h-0 flex-1">
            <TranscriptView
              segments={transcript.segments}
              speakers={transcript.speakers}
              currentSegmentIndex={currentSegmentIndex}
              autoFollow={autoFollow}
              mediaAvailable={mediaAvailable}
              onSeek={onSeek}
              onSaveSegmentText={onSaveSegmentText}
              onAssignSpeaker={onAssignSpeaker}
              notes={notes}
              onAddNoteAt={onAddNoteAt}
              onOpenNote={onOpenNote}
              claims={claims}
              onOpenClaim={onOpenClaim}
              translation={display.mode === 'original' ? null : { mode: display.mode, texts }}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <FileText className="size-4" />
            尚無逐字稿
          </div>
        )}
      </div>
    </Card>
  )
}

// The Job's 標題 (or its file name when it has none), changed in place: empty clears it back to the file name. Once the
// user has set it the AI leaves it alone (see upload-service CONTEXT.md).
function JobTitle({ job, onUpdateJob }: { job: Job; onUpdateJob: (update: JobUpdate) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <NameInput
        label="標題"
        initialName={job.title ?? ''}
        placeholder={job.fileName}
        failureMessage="標題沒有存到"
        onSave={(title) => onUpdateJob({ title })}
        onDone={() => setEditing(false)}
        className="-ml-1.5 max-w-full min-w-40 text-sm font-medium"
      />
    )
  }
  return (
    <div className="group/title flex min-w-0 items-center gap-1">
      <h2 title={jobDisplayName(job)} className="truncate text-sm leading-snug font-medium">
        {jobDisplayName(job)}
      </h2>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="改標題"
        title="改標題"
        onClick={() => setEditing(true)}
        className="shrink-0 text-muted-foreground opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
      >
        <Pencil />
      </Button>
    </div>
  )
}

// The Job's 類型, picked from the fixed list. Shows the choice straight away and puts it back if saving fails.
function CategorySelect({
  category,
  onUpdateJob,
}: {
  category: JobCategory | null | undefined
  onUpdateJob: (update: JobUpdate) => Promise<void>
}) {
  const [pending, setPending] = useState<JobCategory | null>(null)
  const shown = pending ?? category ?? ''
  return (
    <select
      aria-label="類型"
      value={shown}
      disabled={pending !== null}
      onChange={async (event) => {
        const chosen = event.target.value as JobCategory
        setPending(chosen)
        try {
          await onUpdateJob({ category: chosen })
        } catch {
          toast.error('類型沒有存到')
        }
        setPending(null)
      }}
      className="shrink-0 rounded-sm bg-transparent py-0.5 text-xs text-foreground/80 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
    >
      {shown === '' && (
        <option value="" disabled>
          未分類
        </option>
      )}
      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  )
}
