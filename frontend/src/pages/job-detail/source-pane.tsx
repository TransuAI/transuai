import { FileText } from 'lucide-react'
import { formatBytes, formatDuration } from '@/lib/media'
import { cn } from '@/lib/utils'
import { JobStatusBadge } from '@/components/job-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Job, Transcript } from '@/types/api'

interface SourcePaneProps {
  job: Job
  mediaUrl: string | undefined
  transcript: Transcript | null
  currentSegmentIndex: number | null
  setMediaRef: (el: HTMLMediaElement | null) => void
  onSeek: (seconds: number) => void
}

export function SourcePane({ job, mediaUrl, transcript, currentSegmentIndex, setMediaRef, onSeek }: SourcePaneProps) {
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
          <ScrollArea className="h-full pr-4">
            <div className="flex flex-col gap-3">
              {transcript.segments.map((segment, i) => (
                <div
                  key={i}
                  aria-current={i === currentSegmentIndex ? 'true' : undefined}
                  className={cn(
                    '-mx-2 flex gap-3 rounded-md px-2 py-1 text-sm transition-colors',
                    i === currentSegmentIndex && 'bg-primary/10',
                  )}
                >
                  <button
                    type="button"
                    disabled={!mediaUrl}
                    onClick={() => onSeek(segment.startTime)}
                    className="h-fit shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
                  >
                    {formatDuration(segment.startTime)}
                  </button>
                  <p className="leading-relaxed">
                    {segment.speakerLabel && <span className="mr-1 font-medium">{segment.speakerLabel}:</span>}
                    {segment.text}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
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
