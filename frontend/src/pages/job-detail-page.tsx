import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { chapterApi, jobsApi, qaApi, summaryApi, transcriptApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { formatBytes, formatDuration } from '@/lib/media'
import { useJobSocket } from '@/hooks/use-job-socket'
import { JobStatusBadge, isJobInProgress } from '@/components/job-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { SourcePane } from '@/pages/job-detail/source-pane'
import { ChatPane, type QaEntry } from '@/pages/job-detail/chat-pane'
import { StudioPane } from '@/pages/job-detail/studio-pane'
import type { Chapter, Job, JobStatusEvent, Summary, Transcript } from '@/types/api'

const MEDIA_BASE_URL = import.meta.env.VITE_MEDIA_BASE_URL as string | undefined

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [qaHistory, setQaHistory] = useState<QaEntry[]>([])
  const [questionInput, setQuestionInput] = useState('')
  const [isAsking, setIsAsking] = useState(false)
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

  const handleAskQuestion = async () => {
    const question = questionInput.trim()
    if (!jobId || !question || isAsking) return
    setIsAsking(true)
    try {
      const answer = await qaApi.ask(jobId, question)
      setQaHistory((prev) => [...prev, { question, answer }])
      setQuestionInput('')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '問答失敗')
    } finally {
      setIsAsking(false)
    }
  }

  if (isLoadingJob) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Alert variant="destructive">
          <AlertTitle>找不到這個 Job</AlertTitle>
          <AlertDescription>它可能已被刪除,或不屬於你的帳號。</AlertDescription>
        </Alert>
      </div>
    )
  }

  const mediaUrl = MEDIA_BASE_URL ? `${MEDIA_BASE_URL}/${job.storagePath}` : undefined

  if (job.status !== 'COMPLETED') {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
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
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[32rem] flex-col gap-4 md:h-[calc(100vh-3rem)]">
      <Button asChild variant="ghost" size="sm" className="w-fit -ml-2 shrink-0">
        <Link to="/jobs">
          <ArrowLeft className="size-4" />
          返回列表
        </Link>
      </Button>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)_20rem]">
        <SourcePane job={job} mediaUrl={mediaUrl} transcript={transcript} setMediaRef={setMediaRef} onSeek={seekTo} />
        <ChatPane
          qaHistory={qaHistory}
          questionInput={questionInput}
          onQuestionInputChange={setQuestionInput}
          isAsking={isAsking}
          onAsk={() => void handleAskQuestion()}
          onSeek={seekTo}
          mediaAvailable={Boolean(mediaUrl)}
        />
        <StudioPane summary={summary} chapters={chapters} onSeek={seekTo} mediaAvailable={Boolean(mediaUrl)} />
      </div>
    </div>
  )
}
