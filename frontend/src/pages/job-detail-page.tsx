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
import { CompletedWorkspace } from '@/pages/job-detail/completed-workspace'
import type { QaEntry } from '@/pages/job-detail/chat-pane'
import type { Chapter, Job, JobStatusEvent, Summary, Transcript } from '@/types/api'

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | undefined>(undefined)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [qaHistory, setQaHistory] = useState<QaEntry[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [questionInput, setQuestionInput] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [isLoadingJob, setIsLoadingJob] = useState(true)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const [isMediaMounted, setIsMediaMounted] = useState(false)
  const setMediaRef = (el: HTMLMediaElement | null) => {
    mediaRef.current = el
    setIsMediaMounted(el !== null)
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

  // 只抓一次，不跟著 loadJob 的 4 秒輪詢重複要 URL——storage_path 在 Job 建立時就固定了，
  // 播放 URL 不會因為 job 狀態變化而變，且 presigned URL 有效期遠長於一般頁面停留時間
  // （見 docs/adr/0002-presigned-get-url-for-media-playback.md）。
  useEffect(() => {
    if (!jobId) return
    jobsApi
      .getMediaUrl(jobId)
      .then((res) => setMediaUrl(res.downloadUrl))
      .catch(() => setMediaUrl(undefined))
  }, [jobId])

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
      setIsLoadingHistory(true)
      qaApi
        .history(jobId)
        .then((turns) =>
          setQaHistory(
            turns.map((turn) => ({
              id: crypto.randomUUID(),
              question: turn.question,
              answer: turn.answer,
              sourceTimestamps: turn.sourceTimestamps,
              status: 'done',
            })),
          ),
        )
        .catch(() => setQaHistory([]))
        .finally(() => setIsLoadingHistory(false))
    }
  }, [jobId, jobStatus])

  const seekTo = (seconds: number) => {
    if (mediaRef.current) {
      mediaRef.current.currentTime = seconds
      void mediaRef.current.play()
    }
  }

  const handleAskQuestion = () => {
    const question = questionInput.trim()
    if (!jobId || !question || isAsking) return

    const id = crypto.randomUUID()
    setQaHistory((prev) => [...prev, { id, question, answer: '', sourceTimestamps: [], status: 'streaming' }])
    setQuestionInput('')
    setIsAsking(true)

    const patchEntry = (patch: Partial<QaEntry>) =>
      setQaHistory((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))

    // failed 這個 flag 是必要的：中途失敗時 onError 會先把狀態標成 error，但 requestSse()
    // 之後還是會正常 resolve（error event 之後 stream 乾淨結束，不是 fetch 層級的失敗），
    // 沒有這個 flag，下面的 .then() 會把 status 蓋回 'done'。
    let failed = false
    qaApi
      .ask(jobId, question, {
        onSources: (sourceTimestamps) => patchEntry({ sourceTimestamps }),
        onDelta: (text) =>
          setQaHistory((prev) =>
            prev.map((entry) => (entry.id === id ? { ...entry, answer: entry.answer + text } : entry)),
          ),
        onError: () => {
          failed = true
          patchEntry({ status: 'error' })
          toast.error('問答失敗')
        },
      })
      .then(() => {
        if (!failed) patchEntry({ status: 'done' })
      })
      .catch((err) => {
        patchEntry({ status: 'error' })
        toast.error(err instanceof ApiError ? err.message : '問答失敗')
      })
      .finally(() => setIsAsking(false))
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
    <CompletedWorkspace
      job={job}
      mediaUrl={mediaUrl}
      mediaAvailable={Boolean(mediaUrl) && isMediaMounted}
      transcript={transcript}
      summary={summary}
      chapters={chapters}
      qaHistory={qaHistory}
      isLoadingHistory={isLoadingHistory}
      questionInput={questionInput}
      onQuestionInputChange={setQuestionInput}
      isAsking={isAsking}
      onAsk={handleAskQuestion}
      onSeek={seekTo}
      setMediaRef={setMediaRef}
    />
  )
}
