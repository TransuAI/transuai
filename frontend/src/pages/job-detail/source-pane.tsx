import type { ReactNode } from 'react'
import { FileAudio, FileText, FileVideo, PanelLeftClose } from 'lucide-react'
import { formatBytes, formatDuration, formatShortDateTime } from '@/lib/media'
import type { AutoFollow } from '@/hooks/use-auto-follow'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SpeakerPanel } from '@/pages/job-detail/speaker-panel'
import { TranscriptView } from '@/pages/job-detail/transcript-view'
import { cn } from '@/lib/utils'
import type { Job, SpeakerAssignment, Transcript } from '@/types/api'

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
  onAssignSpeaker: (segmentId: string, assignment: SpeakerAssignment) => Promise<void>
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
  onAssignSpeaker,
  onCollapse,
  className,
}: SourcePaneProps) {
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
            <h2 title={job.fileName} className="truncate text-sm leading-snug font-medium">
              {job.fileName}
            </h2>
            <p className="truncate text-xs text-muted-foreground tabular-nums">
              {formatDuration(job.durationSeconds)} · {formatBytes(job.fileSizeBytes)} · {formatShortDateTime(job.createdAt)}
            </p>
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
          <SpeakerPanel transcript={transcript} onRename={onRenameSpeaker} />
        </div>
      )}
      <div className="min-h-0 flex-1 px-4 pt-3">
        {transcript ? (
          <TranscriptView
            segments={transcript.segments}
            speakers={transcript.speakers}
            currentSegmentIndex={currentSegmentIndex}
            autoFollow={autoFollow}
            mediaAvailable={mediaAvailable}
            onSeek={onSeek}
            onSaveSegmentText={onSaveSegmentText}
            onAssignSpeaker={onAssignSpeaker}
          />
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
