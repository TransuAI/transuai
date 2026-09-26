import type { ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { formatBytes, formatDuration } from '@/lib/media'
import type { AutoFollow } from '@/hooks/use-auto-follow'
import { JobStatusBadge } from '@/components/job-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TranscriptView } from '@/pages/job-detail/transcript-view'
import type { Job, Transcript } from '@/types/api'

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
}: SourcePaneProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="gap-2 border-b pb-4">
        <div className="flex items-start justify-between gap-4">
          <CardTitle className="break-all text-base">{job.fileName}</CardTitle>
          <JobStatusBadge status={job.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {formatBytes(job.fileSizeBytes)} · {formatDuration(job.durationSeconds)} ·{' '}
          {new Date(job.createdAt).toLocaleString()}
        </p>
        {player}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pt-4">
        {transcript ? (
          <TranscriptView
            segments={transcript.segments}
            speakers={transcript.speakers}
            currentSegmentIndex={currentSegmentIndex}
            autoFollow={autoFollow}
            mediaAvailable={mediaAvailable}
            onSeek={onSeek}
            onSaveSegmentText={onSaveSegmentText}
          />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <FileText className="size-4" />
            尚無逐字稿
          </div>
        )}
      </CardContent>
    </Card>
  )
}
