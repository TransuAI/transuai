import { useState } from 'react'
import { GraduationCap, Loader2Icon, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Quiz } from '@/types/api'

const QUESTION_COUNTS = [5, 10, 20] as const
const DEFAULT_QUESTION_COUNT = 10

function shortTime(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface QuizSectionProps {
  quizzes: Quiz[]
  onRequestQuiz: (questionCount: number) => void
  /** A request is on its way; one click is one request. */
  isRequesting: boolean
}

// 測驗 (see ai-service CONTEXT.md): the Studio card to generate quizzes from the whole job and list them.
export function QuizSection({ quizzes, onRequestQuiz, isRequesting }: QuizSectionProps) {
  const [questionCount, setQuestionCount] = useState<number>(DEFAULT_QUESTION_COUNT)

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
                <span className="text-xs text-muted-foreground">{shortTime(quiz.completedAt ?? quiz.requestedAt)}</span>
              </div>
              {quiz.status === 'GENERATING' && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  產生中…
                </p>
              )}
              {quiz.status === 'COMPLETED' && quiz.model && (
                <p className="text-xs text-muted-foreground/80">由 {quiz.model} 產生</p>
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
    </section>
  )
}
