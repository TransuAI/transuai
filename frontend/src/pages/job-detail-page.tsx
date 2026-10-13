import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { chapterApi, jobsApi, modelsApi, qaApi, speakerSuggestionsApi, summaryApi, transcriptApi, usageApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { findCurrentSegmentIndex } from '@/lib/current-segment'
import { formatBytes, formatDuration } from '@/lib/media'
import { sameModel } from '@/lib/providers'
import { useAutoFollow } from '@/hooks/use-auto-follow'
import { useJobSocket } from '@/hooks/use-job-socket'
import { usePlaybackContinuity } from '@/hooks/use-playback-continuity'
import { useNotes } from '@/hooks/use-notes'
import { usePostMeeting } from '@/hooks/use-post-meeting'
import { useQuizzes } from '@/hooks/use-quizzes'
import { useSpeakerInsights } from '@/hooks/use-speaker-insights'
import { useOutputs } from '@/hooks/use-outputs'
import { useTranslations } from '@/hooks/use-translations'
import { useDecisions } from '@/hooks/use-decisions'
import { useFactCheck } from '@/hooks/use-fact-check'
import { useSummaryRegeneration } from '@/hooks/use-summary-regeneration'
import { JobStatusBadge, isJobInProgress } from '@/components/job-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CompletedWorkspace } from '@/pages/job-detail/completed-workspace'
import type { QaEntry } from '@/pages/job-detail/chat-pane'
import type { SpeakerSuggestionActions } from '@/pages/job-detail/speaker-panel'
import type { Chapter, Job, JobStatusEvent, JobUpdate, JobUsage, ModelChoice, SpeakerAssignment, SpeakerSuggestion, Summary, Transcript } from '@/types/api'

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | undefined>(undefined)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [usage, setUsage] = useState<JobUsage | null>(null)
  // Models the user can answer with, the default model, and the one picked for the next question (the default at first).
  const [modelChoices, setModelChoices] = useState<ModelChoice[]>([])
  const [defaultModel, setDefaultModel] = useState<ModelChoice | null>(null)
  const [selectedModel, setSelectedModel] = useState<ModelChoice | null>(null)
  const [qaHistory, setQaHistory] = useState<QaEntry[]>([])
  const [speakerSuggestions, setSpeakerSuggestions] = useState<SpeakerSuggestion[]>([])
  // 查網路: offered only when the deployment can search; once switched on it stays on for the next questions on this page.
  const [webSearchAvailable, setWebSearchAvailable] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  // How many more times questions can search the web this month (用量上限); null while unknown (not loaded, or an older
  // gateway), which doesn't hold the switch back — the server still refuses once the limit is reached.
  const [webSearchesLeft, setWebSearchesLeft] = useState<number | null>(null)
  const reloadWebSearchesLeft = useCallback(() => {
    usageApi
      .getMonthly()
      .then(({ webSearches, limits }) =>
        setWebSearchesLeft(
          webSearches && limits.webSearches !== undefined ? Math.max(0, limits.webSearches - webSearches.succeeded) : null,
        ),
      )
      .catch(() => {}) // keeps what's on screen
  }, [])
  useEffect(() => {
    if (webSearchAvailable) reloadWebSearchesLeft()
  }, [webSearchAvailable, reloadWebSearchesLeft])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [questionInput, setQuestionInput] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [isLoadingJob, setIsLoadingJob] = useState(true)
  const [mediaElement, setMediaElement] = useState<HTMLMediaElement | null>(null)
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number | null>(null)
  const autoFollow = useAutoFollow()
  const resumeFollow = autoFollow.resume

  const loadJob = useCallback(async () => {
    if (!jobId) return
    try {
      const data = await jobsApi.get(jobId)
      setJob(data)
    } catch (err) {
      // 同一個 id：輪詢每 4 秒失敗一次（例如被限流）時換掉同一個提示，不要一直疊新的。
      toast.error(err instanceof ApiError ? err.message : '無法載入 Job', { id: `load-job-${jobId}` })
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

  // Must run before the current-segment sync below, so that sync already reads the position
  // restored onto a remounted media element.
  usePlaybackContinuity(mediaElement)

  // Only the current segment index is kept in state (not the raw playback time), so the
  // workspace re-renders when playback crosses into another segment, not on every
  // ~250ms timeupdate. Syncing once on attach matters: a remounted player (layout switch)
  // has to be read from its own, restored currentTime.
  useEffect(() => {
    if (!mediaElement || !transcript) {
      setCurrentSegmentIndex(null)
      return
    }
    const sync = () => setCurrentSegmentIndex(findCurrentSegmentIndex(transcript.segments, mediaElement.currentTime))
    // Seeking with the player's own progress bar is also "take me to that point in time",
    // so it resumes auto-follow just like clicking a timestamp does.
    const syncAndResume = () => {
      sync()
      resumeFollow()
    }
    sync()
    mediaElement.addEventListener('timeupdate', sync)
    mediaElement.addEventListener('seeked', syncAndResume)
    return () => {
      mediaElement.removeEventListener('timeupdate', sync)
      mediaElement.removeEventListener('seeked', syncAndResume)
    }
  }, [mediaElement, transcript, resumeFollow])

  useEffect(() => {
    if (!jobId || !jobStatus) return
    if (jobStatus === 'COMPLETED') {
      summaryApi.get(jobId).then(setSummary).catch(() => setSummary(null))
      // Nice to have: without them the speakers just keep their numbers.
      speakerSuggestionsApi.list(jobId).then(setSpeakerSuggestions).catch(() => setSpeakerSuggestions([]))
      chapterApi.list(jobId).then(setChapters).catch(() => setChapters([]))
      usageApi.getJobUsage(jobId).then(setUsage).catch(() => setUsage(null))
      Promise.all([modelsApi.available(), modelsApi.getDefault()])
        .then(([available, current]) => {
          const listed = available.models.some((m) => sameModel(m, current))
          setModelChoices(listed ? available.models : [...available.models, current])
          setWebSearchAvailable(available.webSearch ?? false)
          setDefaultModel(current)
          setSelectedModel(current)
        })
        .catch(() => {}) // without the list, questions just go to the default model
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
              model: turn.model,
              webSearch: turn.webSearch ?? false,
              webSources: turn.webSources ?? [],
            })),
          ),
        )
        .catch(() => setQaHistory([]))
        .finally(() => setIsLoadingHistory(false))
    }
  }, [jobId, jobStatus])

  // 用量 grows with every model call: loaded with the workspace, then again after each answer and
  // regeneration. A failed reload keeps what's on screen.
  const reloadUsage = useCallback(() => {
    if (jobId) usageApi.getJobUsage(jobId).then(setUsage).catch(() => {})
  }, [jobId])

  // After a regeneration: new chapters only if it succeeded (a failed reload keeps the ones on screen), new
  // usage either way.
  const reloadAfterRegeneration = useCallback(
    (succeeded: boolean) => {
      if (jobId && succeeded) chapterApi.list(jobId).then(setChapters).catch(() => {})
      reloadUsage()
    },
    [jobId, reloadUsage],
  )
  const regeneration = useSummaryRegeneration(jobId, summary, setSummary, reloadAfterRegeneration)
  const quizzes = useQuizzes(jobId, jobStatus === 'COMPLETED', reloadUsage)
  const speakerInsights = useSpeakerInsights(jobId, jobStatus === 'COMPLETED', reloadUsage)
  const decisions = useDecisions(jobId, jobStatus === 'COMPLETED', reloadUsage)
  // Checking claims searches the web: once it settles, this month's searches left go down too.
  const reloadAfterFactCheck = useCallback(() => {
    reloadUsage()
    reloadWebSearchesLeft()
  }, [reloadUsage, reloadWebSearchesLeft])
  const factCheck = useFactCheck(jobId, jobStatus === 'COMPLETED', reloadAfterFactCheck)
  const outputs = useOutputs(jobId, jobStatus === 'COMPLETED', reloadUsage)
  const translations = useTranslations(jobId, jobStatus === 'COMPLETED', reloadUsage, transcript)
  const postMeeting = usePostMeeting(jobId, jobStatus === 'COMPLETED', reloadUsage)
  const notes = useNotes(jobId, jobStatus === 'COMPLETED')
  // Capped at the recorded length: a media element can report a little past it at the very end, and a note's time must
  // fall within the recording.
  const currentTime = () => (mediaElement ? Math.min(mediaElement.currentTime, job?.durationSeconds ?? Infinity) : null)

  const seekTo = (seconds: number) => {
    if (mediaElement) {
      mediaElement.currentTime = seconds
      void mediaElement.play()
    }
    // Don't wait for the player's `seeked` event: with a remote media URL it only fires once
    // enough data has buffered, and the highlight should move the moment the user jumps.
    if (transcript) setCurrentSegmentIndex(findCurrentSegmentIndex(transcript.segments, seconds))
    // Jumping to a timestamp (transcript, chapter, citation) is an explicit "take me to the
    // playback position", so it resumes auto-follow too.
    resumeFollow()
  }

  // The 決策 page links to where a decision was made (/jobs/…?t=…): go there once the player and transcript are ready,
  // without starting playback (the browser wouldn't let it start on its own anyway).
  const [searchParams] = useSearchParams()
  const timeInAddress = Number.parseFloat(searchParams.get('t') ?? '')
  const wentToTimeInAddress = useRef(false)
  useEffect(() => {
    if (wentToTimeInAddress.current || !Number.isFinite(timeInAddress) || !mediaElement || !transcript) return
    wentToTimeInAddress.current = true
    mediaElement.currentTime = timeInAddress
    setCurrentSegmentIndex(findCurrentSegmentIndex(transcript.segments, timeInAddress))
  }, [timeInAddress, mediaElement, transcript])

  // 編輯（見 transcription-service CONTEXT.md）：存檔後用回應的片段跟版本號更新逐字稿。失敗時
  // 讓錯誤往外拋，編輯器會保留使用者打的字並提示。
  const handleSaveSegmentText = async (segmentId: string, text: string) => {
    if (!jobId) return
    const { segment, revision } = await transcriptApi.updateSegmentText(jobId, segmentId, text)
    setTranscript((prev) =>
      prev
        ? { ...prev, revision, segments: prev.segments.map((s) => (s.id === segment.id ? segment : s)) }
        : prev,
    )
  }

  // 替講者命名也是一次編輯：用回應的講者跟版本號更新逐字稿，失敗時讓錯誤往外拋給改名的輸入框。
  // 講者名字建議: applying one is the usual rename, then the suggestion is marked applied. A suggestion whose speaker was renamed
  // is hidden either way, so failing to mark it only logs. The toast names the speaker by the name shown before the rename.
  const markSuggestion = (label: string, status: 'applied' | 'dismissed') => {
    setSpeakerSuggestions((prev) => prev.map((s) => (s.speakerLabel === label ? { ...s, status } : s)))
    if (jobId) speakerSuggestionsApi.setStatus(jobId, label, status).catch(() => {})
  }
  const applySuggestion = async (suggestion: SpeakerSuggestion) => {
    const shownAs = transcript?.speakers.find((s) => s.label === suggestion.speakerLabel)?.displayName ?? suggestion.speakerLabel
    try {
      await handleRenameSpeaker(suggestion.speakerLabel, suggestion.name)
    } catch {
      toast.error(`套用失敗：${shownAs}`)
      return
    }
    markSuggestion(suggestion.speakerLabel, 'applied')
  }
  const speakerSuggestionActions: SpeakerSuggestionActions = {
    suggestions: speakerSuggestions,
    apply: applySuggestion,
    dismiss: (label) => markSuggestion(label, 'dismissed'),
    // One at a time: each rename is an edit with its own revision.
    applyAll: async (pending) => {
      for (const suggestion of pending) await applySuggestion(suggestion)
    },
  }

  // 改標題／類型：用回應的 Job 更新（狀態等其他欄位也跟著是最新的）。失敗 reject，由畫面提示。
  const handleUpdateJob = async (update: JobUpdate) => {
    if (!jobId) return
    setJob(await jobsApi.update(jobId, update))
  }

  const handleRenameSpeaker = async (label: string, name: string) => {
    if (!jobId) return
    const { speaker, revision } = await transcriptApi.renameSpeaker(jobId, label, name)
    setTranscript((prev) =>
      prev
        ? { ...prev, revision, speakers: prev.speakers.map((s) => (s.label === speaker.label ? speaker : s)) }
        : prev,
    )
  }

  // 改片段的講者也是一次編輯：用回應的片段、講者列表（可能多了新增的講者）跟版本號更新逐字稿。講者分離之前的
  // 舊逐字稿沒有講者，後端會把其他片段一起歸給新的講者 1——那些片段不在回應裡，直接重新讀一次逐字稿。
  const handleAssignSpeaker = async (segmentId: string, assignment: SpeakerAssignment) => {
    if (!jobId) return
    const hadNoSpeakers = transcript?.speakers.length === 0
    const { segment, speakers, revision } = await transcriptApi.assignSegmentSpeaker(jobId, segmentId, assignment)
    if (hadNoSpeakers) {
      // The change is saved either way; if re-reading fails, the page just shows it once reloaded.
      const reloaded = await transcriptApi.get(jobId).catch(() => null)
      if (reloaded) {
        setTranscript(reloaded)
        return
      }
    }
    setTranscript((prev) =>
      prev
        ? { ...prev, revision, speakers, segments: prev.segments.map((s) => (s.id === segment.id ? segment : s)) }
        : prev,
    )
  }

  const handleAskQuestion = () => {
    const question = questionInput.trim()
    if (!jobId || !question || isAsking) return

    const id = crypto.randomUUID()
    const searchesTheWeb = webSearchAvailable && webSearch && webSearchesLeft !== 0
    setQaHistory((prev) => [
      ...prev,
      { id, question, answer: '', sourceTimestamps: [], status: 'streaming', webSearch: searchesTheWeb },
    ])
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
        onError: (message) => {
          failed = true
          patchEntry({ status: 'error' })
          // e.g. 「openai（gpt-5）額度不足：…」 when the user's own key ran out
          toast.error(message || '問答失敗')
        },
        onModel: (answeredBy) => patchEntry({ model: answeredBy.model }),
        onWebSources: (result) => patchEntry({ webSources: result.sources }),
        // A step that comes again (running → done) updates its row in place; a new one is added at the end.
        onStep: (step) =>
          setQaHistory((prev) =>
            prev.map((entry) => {
              if (entry.id !== id) return entry
              const steps = entry.steps ?? []
              return {
                ...entry,
                steps: steps.some((s) => s.id === step.id)
                  ? steps.map((s) => (s.id === step.id ? step : s))
                  : [...steps, step],
              }
            }),
          ),
        ...(searchesTheWeb && { webSearch: true }),
        // Only a model picked for this question is sent; for the default the server uses whatever it is by now.
        ...(selectedModel && !sameModel(defaultModel, selectedModel) && {
          model: { provider: selectedModel.provider, model: selectedModel.model },
        }),
      })
      .then(() => {
        if (!failed) patchEntry({ status: 'done' })
      })
      .catch((err) => {
        patchEntry({ status: 'error' })
        toast.error(err instanceof ApiError ? err.message : '問答失敗')
      })
      .finally(() => {
        setIsAsking(false)
        reloadUsage()
        if (searchesTheWeb) reloadWebSearchesLeft()
      })
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
                <video ref={setMediaElement} src={mediaUrl} controls className="w-full rounded-md" />
              ) : (
                <audio ref={setMediaElement} src={mediaUrl} controls className="w-full" />
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
      mediaAvailable={Boolean(mediaUrl) && mediaElement !== null}
      transcript={transcript}
      currentSegmentIndex={currentSegmentIndex}
      autoFollow={autoFollow}
      summary={summary}
      chapters={chapters}
      qaHistory={qaHistory}
      isLoadingHistory={isLoadingHistory}
      questionInput={questionInput}
      onQuestionInputChange={setQuestionInput}
      isAsking={isAsking}
      onAsk={handleAskQuestion}
      webSearchAvailable={webSearchAvailable}
      webSearch={webSearch}
      webSearchesLeft={webSearchesLeft}
      onWebSearchChange={setWebSearch}
      onSeek={seekTo}
      onSaveSegmentText={handleSaveSegmentText}
      onRenameSpeaker={handleRenameSpeaker}
      onUpdateJob={handleUpdateJob}
      speakerSuggestions={speakerSuggestionActions}
      onAssignSpeaker={handleAssignSpeaker}
      onRegenerateSummary={regeneration.regenerate}
      isRegeneratingSummary={regeneration.isRegenerating}
      isRequestingRegeneration={regeneration.isRequesting}
      quizzes={quizzes.quizzes}
      onRequestQuiz={quizzes.requestQuiz}
      isRequestingQuiz={quizzes.isRequesting}
      onQuizAttempted={quizzes.reload}
      speakerInsights={speakerInsights}
      decisions={decisions}
      factCheck={factCheck}
      outputs={outputs}
      translations={translations}
      postMeeting={postMeeting.postMeeting}
      onStartPostMeeting={postMeeting.start}
      isStartingPostMeeting={postMeeting.isStarting}
      onExecuteProposals={postMeeting.execute}
      onRetryProposal={postMeeting.retry}
      isExecutingProposals={postMeeting.isExecuting}
      notes={notes}
      currentTime={currentTime}
      usage={usage}
      modelChoices={modelChoices}
      selectedModel={selectedModel}
      onSelectModel={setSelectedModel}
      setMediaRef={setMediaElement}
    />
  )
}
