import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, FileText, List, Sparkles } from 'lucide-react'
import { chapterApi, jobsApi, summaryApi, transcriptApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { formatBytes, formatDuration } from '@/lib/media'
import { useJobSocket } from '@/hooks/use-job-socket'
import { JobStatusBadge, isJobInProgress } from '@/components/job-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Chapter, Job, JobStatusEvent, Summary, Transcript } from '@/types/api'

const MEDIA_BASE_URL = import.meta.env.VITE_MEDIA_BASE_URL as string | undefined

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [isLoadingJob, setIsLoadingJob] = useState(true)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const setMediaRef = (el: HTMLMediaElement | null) => {
    mediaRef.current = el
  }

  const loadJob = useCallback(async () => {
    if (!jobId) return
    try {
      const data = await jobsApi.get(jobId)
      setJob(data)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '無法載入 Job')
    } finally {
      setIsLoadingJob(false)
    }
  }, [jobId])

  useEffect(() => {
    void loadJob()
  }, [loadJob])

  useEffect(() => {
    if (!job || !isJobInProgress(job.status)) return
    const timer = setInterval(() => void loadJob(), 4000)
    return () => clearInterval(timer)
  }, [job, loadJob])

  const handleSocketEvent = useCallback((event: JobStatusEvent) => {
    setJob((prev) =>
      prev
        ? { ...prev, status: event.status, errorReason: event.errorReason ?? prev.errorReason }
        : prev,
    )
  }, [])
  useJobSocket(jobId, handleSocketEvent)

  const jobStatus = job?.status

  useEffect(() => {
    if (!jobId || !jobStatus) return
    if (jobStatus === 'TRANSCRIBED' || jobStatus === 'SUMMARIZING' || jobStatus === 'COMPLETED') {
      transcriptApi.get(jobId).then(setTranscript).catch(() => setTranscript(null))
    }
  }, [jobId, jobStatus])

  useEffect(() => {
    if (!jobId || !jobStatus) return
    if (jobStatus === 'COMPLETED') {
      summaryApi.get(jobId).then(setSummary).catch(() => setSummary(null))
      chapterApi.list(jobId).then(setChapters).catch(() => setChapters([]))
    }
  }, [jobId, jobStatus])

  const seekTo = (seconds: number) => {
    if (mediaRef.current) {
      mediaRef.current.currentTime = seconds
      void mediaRef.current.play()
    }
  }

  if (isLoadingJob) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!job) {
    return (
      <Alert variant="destructive">
        <AlertTitle>找不到這個 Job</AlertTitle>
        <AlertDescription>它可能已被刪除,或不屬於你的帳號。</AlertDescription>
      </Alert>
    )
  }

  const mediaUrl = MEDIA_BASE_URL ? `${MEDIA_BASE_URL}/${job.storagePath}` : undefined

  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="w-fit -ml-2">
        <Link to="/jobs">
          <ArrowLeft className="size-4" />
          返回列表
        </Link>
      </Button>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="break-all">{job.fileName}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatBytes(job.fileSizeBytes)} · {formatDuration(job.durationSeconds)} ·{' '}
              {new Date(job.createdAt).toLocaleString()}
            </p>
          </div>
          <JobStatusBadge status={job.status} />
        </CardHeader>
        {job.status === 'FAILED' && job.errorReason && (
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>處理失敗</AlertTitle>
              <AlertDescription>{job.errorReason}</AlertDescription>
            </Alert>
          </CardContent>
        )}
        {isJobInProgress(job.status) && (
          <CardContent>
            <p className="text-sm text-muted-foreground">處理中,完成後這裡會自動更新逐字稿與摘要...</p>
          </CardContent>
        )}
        {mediaUrl && (
          <CardContent>
            {job.fileType === 'VIDEO' ? (
              <video ref={setMediaRef} src={mediaUrl} controls className="w-full rounded-md" />
            ) : (
              <audio ref={setMediaRef} src={mediaUrl} controls className="w-full" />
            )}
          </CardContent>
        )}
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" />
              AI 摘要
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{summary.summaryText}</p>
          </CardContent>
        </Card>
      )}

      {chapters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <List className="size-4" />
              章節
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  type="button"
                  disabled={!mediaUrl}
                  onClick={() => seekTo(chapter.startTime)}
                  className="flex items-center gap-3 rounded text-left text-sm enabled:hover:text-accent-foreground disabled:opacity-60"
                >
                  <span className="h-fit shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {formatDuration(chapter.startTime)}
                  </span>
                  <span className="leading-relaxed">{chapter.title}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {transcript && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4" />
              逐字稿
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96 pr-4">
              <div className="flex flex-col gap-3">
                {transcript.segments.map((segment, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <button
                      type="button"
                      disabled={!mediaUrl}
                      onClick={() => seekTo(segment.startTime)}
                      className="h-fit shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
                    >
                      {formatDuration(segment.startTime)}
                    </button>
                    <p className="leading-relaxed">
                      {segment.speakerLabel && (
                        <span className="mr-1 font-medium">{segment.speakerLabel}:</span>
                      )}
                      {segment.text}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
