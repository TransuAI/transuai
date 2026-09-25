import { FileText } from 'lucide-react'
import { formatBytes, formatDuration } from '@/lib/media'
import type { AutoFollow } from '@/hooks/use-auto-follow'
import { JobStatusBadge } from '@/components/job-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TranscriptView } from '@/pages/job-detail/transcript-view'
import type { Job, Transcript } from '@/types/api'

interface SourcePaneProps {
  job: Job
  mediaUrl: string | undefined
  transcript: Transcript | null
  currentSegmentIndex: number | null
  autoFollow: AutoFollow
  setMediaRef: (el: HTMLMediaElement | null) => void
  onSeek: (seconds: number) => void
}

export function SourcePane({
  job,
  mediaUrl,
  transcript,
  currentSegmentIndex,
  autoFollow,
  setMediaRef,
  onSeek,
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
        {mediaUrl &&
          (job.fileType === 'VIDEO' ? (
            <video ref={setMediaRef} src={mediaUrl} controls className="w-full rounded-md" />
          ) : (
            <audio ref={setMediaRef} src={mediaUrl} controls className="w-full" />
          ))}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pt-4">
        {transcript ? (
          <TranscriptView
            segments={transcript.segments}
            currentSegmentIndex={currentSegmentIndex}
            autoFollow={autoFollow}
            mediaAvailable={Boolean(mediaUrl)}
            onSeek={onSeek}
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
