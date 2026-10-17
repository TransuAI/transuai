import { useState } from 'react'
import { GraduationCap, History, Loader2Icon, RefreshCw } from 'lucide-react'
import { formatShortDateTime } from '@/lib/media'
import { isQuizStale } from '@/lib/staleness'
import { Button } from '@/components/ui/button'
import { QuizDialog } from '@/pages/job-detail/quiz-dialog'
import { ModelCredit } from '@/components/model-credit'
import type { Quiz, Transcript } from '@/types/api'

const QUESTION_COUNTS = [5, 10, 20] as const
const DEFAULT_QUESTION_COUNT = 10

interface QuizSectionProps {
  jobId: string
  quizzes: Quiz[]
  /** To tell which quizzes were made before the transcript's last edit (過時). */
  transcript: Transcript | null
  onRequestQuiz: (questionCount: number) => void
  /** A request is on its way; one click is one request. */
  isRequesting: boolean
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  /** An attempt was saved: the list's best scores may have changed. */
  onAttempted: () => void
}

// 測驗 (see ai-service CONTEXT.md): the Studio card to generate quizzes from the whole job and list them.
export function QuizSection({
  jobId,
  quizzes,
  transcript,
  onRequestQuiz,
  isRequesting,
  onSeek,
  mediaAvailable,
  onAttempted,
}: QuizSectionProps) {
  const [questionCount, setQuestionCount] = useState<number>(DEFAULT_QUESTION_COUNT)
  const [takingQuizId, setTakingQuizId] = useState<string | null>(null)

  return (
    <section aria-labelledby="quiz-heading" className="flex flex-col gap-2">
      <h3 id="quiz-heading" className="flex items-center gap-2 text-sm font-medium">
        <GraduationCap className="size-4" />
        測驗
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="題數"
          value={questionCount}
          onChange={(e) => setQuestionCount(Number(e.target.value))}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          {QUESTION_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count} 題
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={isRequesting} onClick={() => onRequestQuiz(questionCount)}>
          產生測驗
        </Button>
      </div>
      {quizzes.length > 0 ? (
        <ul className="flex flex-col gap-2 text-sm">
          {quizzes.map((quiz) => (
            <li key={quiz.id} className="flex flex-col gap-1 rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{quiz.questionCount} 題</span>
                {/* When it was made once it's done; until then, when it was asked for. */}
                <span className="text-xs text-muted-foreground">{formatShortDateTime(quiz.completedAt ?? quiz.requestedAt)}</span>
              </div>
              {quiz.status === 'GENERATING' && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  產生中…
                </p>
              )}
              {isQuizStale(quiz, transcript) && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <History className="mt-0.5 size-3.5 shrink-0" />
                  逐字稿已修改，這份測驗可能過時
                </p>
              )}
              {quiz.status === 'COMPLETED' && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {quiz.model && <ModelCredit model={quiz.model} verb="產生" />}
                  {quiz.bestCorrectCount !== null && (
                    <p className="text-xs text-muted-foreground">
                      最佳 {quiz.bestCorrectCount} / {quiz.questionCount}
                    </p>
                  )}
                  <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setTakingQuizId(quiz.id)}>
                    作答
                  </Button>
                </div>
              )}
              {quiz.status === 'FAILED' && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-destructive">{quiz.failureReason ?? '產生失敗'}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-fit"
                    disabled={isRequesting}
                    onClick={() => onRequestQuiz(quiz.questionCount)}
                  >
                    <RefreshCw className="size-3.5" />
                    再試一次
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">還沒有測驗</p>
      )}
      {takingQuizId && (
        <QuizDialog
          key={takingQuizId}
          jobId={jobId}
          quizId={takingQuizId}
          onClose={() => setTakingQuizId(null)}
          onSeek={onSeek}
          mediaAvailable={mediaAvailable}
          onAttempted={onAttempted}
        />
      )}
    </section>
  )
}
