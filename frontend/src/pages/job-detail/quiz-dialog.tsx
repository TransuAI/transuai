import { useEffect, useState } from 'react'
import { Check, Loader2Icon, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { quizApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import type { Quiz, QuizAttemptResult } from '@/types/api'

interface QuizDialogProps {
  jobId: string
  quizId: string
  onClose: () => void
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  /** An attempt was saved (the best score may have changed). */
  onAttempted: () => void
}

// 作答 (see ai-service CONTEXT.md「測驗」): one question at a time with no answers in sight; the service scores
// and keeps every attempt, then each question shows its right answer, the explanation and where in the
// recording it comes from. Mounted per quiz (keyed by its id), so nothing of another quiz ever shows or lands here.
export function QuizDialog({ jobId, quizId, onClose, onSeek, mediaAvailable, onAttempted }: QuizDialogProps) {
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [answers, setAnswers] = useState<(number | null)[]>([])
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<QuizAttemptResult | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    quizApi
      .get(jobId, quizId)
      .then((loaded) => {
        if (cancelled) return
        setQuiz(loaded)
        setAnswers((loaded.questions ?? []).map(() => null))
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [jobId, quizId, loadAttempt])

  const questions = quiz?.questions ?? []
  const unanswered = answers.filter((answer) => answer === null).length

  const submit = () => {
    if (unanswered > 0) return
    setIsSubmitting(true)
    quizApi
      .submitAttempt(jobId, quizId, answers as number[])
      .then((scored) => {
        setResult(scored)
        onAttempted()
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : '送出失敗'))
      .finally(() => setIsSubmitting(false))
  }

  const retake = () => {
    setResult(null)
    setAnswers(questions.map(() => null))
    setIndex(0)
  }

  const question = questions[index]

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>測驗</DialogTitle>
          {/* The question counter, then the score: announced as they change. */}
          <DialogDescription aria-live="polite">
            {result ? `答對 ${result.correctCount} / ${result.questionCount} 題` : question && `第 ${index + 1} / ${questions.length} 題`}
          </DialogDescription>
        </DialogHeader>
        {loadFailed ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            無法載入測驗
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoadFailed(false)
                setLoadAttempt((attempt) => attempt + 1)
              }}
            >
              重試
            </Button>
          </div>
        ) : !quiz ? (
          <Loader2Icon role="status" aria-label="載入中" className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : result ? (
          <div className="flex min-h-0 flex-col gap-3">
            <ol className="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm">
              {questions.map((q, i) => {
                const outcome = result.results[i]
                return (
                  <li key={i} className="flex flex-col gap-1 rounded-md border px-3 py-2">
                    <p className="flex items-start gap-2 font-medium">
                      {outcome.correct ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden />
                      ) : (
                        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                      )}
                      <span className="sr-only">{outcome.correct ? '答對' : '答錯'}</span>
                      {q.prompt}
                    </p>
                    <p className="text-muted-foreground">你的答案：{q.options[outcome.chosenOption]}</p>
                    <p className={outcome.correct ? 'text-muted-foreground' : undefined}>
                      正確答案：{q.options[outcome.correctOption]}
                    </p>
                    <p className="text-muted-foreground">{outcome.explanation}</p>
                    {q.sourceTimestamps.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {q.sourceTimestamps.map((seconds) => (
                          <TimestampButton key={seconds} seconds={seconds} onSeek={onSeek} mediaAvailable={mediaAvailable} />
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
            <Button variant="outline" className="w-fit" onClick={retake}>
              <RotateCcw className="size-4" />
              重做
            </Button>
          </div>
        ) : (
          question && (
            <div className="flex flex-col gap-4">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">{question.prompt}</legend>
                {question.options.map((option, optionIndex) => (
                  <label key={optionIndex} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name={`quiz-question-${index}`}
                      checked={answers[index] === optionIndex}
                      onChange={() =>
                        setAnswers((prev) => prev.map((answer, i) => (i === index ? optionIndex : answer)))
                      }
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                  上一題
                </Button>
                {index < questions.length - 1 ? (
                  <Button size="sm" onClick={() => setIndex(index + 1)}>
                    下一題
                  </Button>
                ) : (
                  <Button size="sm" disabled={unanswered > 0 || isSubmitting} onClick={submit}>
                    送出
                  </Button>
                )}
                {index === questions.length - 1 && unanswered > 0 && (
                  <span className="text-xs text-muted-foreground">還有 {unanswered} 題沒有作答</span>
                )}
              </div>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
