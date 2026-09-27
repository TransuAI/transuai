import { useState } from 'react'
import { CalendarPlus, CheckCircle2, ClipboardList, ExternalLink, Loader2Icon, RotateCcw } from 'lucide-react'
import { fromLocalInput, toLocalInput } from '@/lib/local-time'
import { formatShortDateTime } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ActionProposal, ConfirmedProposal, PostMeeting, PostMeetingRun } from '@/types/api'

function clockTime(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

type Draft = Record<string, unknown>

// A calendar event proposal that isn't done yet: waiting, or failed and fixable.
const isEditable = (proposal: ActionProposal) => proposal.kind === 'calendar_event' && proposal.status !== 'DONE'

// What's wrong with the values in the form, before anything is sent; null when they're fine.
function problemWith(draft: Draft): string | null {
  if (!text(draft.summary).trim()) return '請填標題'
  const start = new Date(text(draft.start)).getTime()
  const end = new Date(text(draft.end)).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return '請填開始與結束時間'
  if (end <= start) return '結束時間要晚於開始時間'
  return null
}

// A calendar-event proposal (行動提案) not carried out yet: a form to check and edit first. A failed one also says why
// and can be tried again on its own.
function CalendarEventForm({
  proposal,
  draft,
  checked,
  onChange,
  onCheck,
  onRetry,
  isExecuting,
}: {
  proposal: ActionProposal
  draft: Draft
  checked: boolean
  onChange: (draft: Draft) => void
  onCheck: (checked: boolean) => void
  onRetry: () => void
  isExecuting: boolean
}) {
  const problem = problemWith(draft)
  const field = (name: string) => `proposal-${proposal.id}-${name}`
  const set = (name: string, value: string) => onChange({ ...draft, [name]: value })
  return (
    <li
      role="group"
      aria-label={`行事曆活動：${text(proposal.arguments.summary)}`}
      className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label="執行這一項" />
        <CalendarPlus className="size-3.5" />
        行事曆活動
      </label>
      <label htmlFor={field('summary')} className="text-xs text-muted-foreground">
        標題
      </label>
      <Input id={field('summary')} value={text(draft.summary)} onChange={(e) => set('summary', e.target.value)} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={field('start')} className="text-xs text-muted-foreground">
            開始
          </label>
          <Input
            id={field('start')}
            type="datetime-local"
            value={toLocalInput(text(draft.start))}
            onChange={(e) => set('start', fromLocalInput(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={field('end')} className="text-xs text-muted-foreground">
            結束
          </label>
          <Input
            id={field('end')}
            type="datetime-local"
            value={toLocalInput(text(draft.end))}
            onChange={(e) => set('end', fromLocalInput(e.target.value))}
          />
        </div>
      </div>
      <label htmlFor={field('description')} className="text-xs text-muted-foreground">
        描述
      </label>
      <textarea
        id={field('description')}
        value={text(draft.description)}
        onChange={(e) => set('description', e.target.value)}
        rows={2}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      />
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      {proposal.status === 'FAILED' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-destructive">{proposal.failureReason ?? '執行失敗'}</p>
          <Button size="sm" variant="outline" className="w-fit" disabled={isExecuting || !!problem} onClick={onRetry}>
            <RotateCcw className="size-3.5" />
            重試
          </Button>
        </div>
      )}
    </li>
  )
}

// A proposal carried out (with a link to what was made), or one of a kind this card can't edit yet.
function ProposalResult({ proposal }: { proposal: ActionProposal }) {
  const { summary, start, end } = proposal.arguments
  return (
    <li className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
      {proposal.kind === 'calendar_event' && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarPlus className="size-3.5" />
          行事曆活動
        </span>
      )}
      <span className="font-medium">{text(summary)}</span>
      {text(start) && text(end) && (
        <span className="text-xs text-muted-foreground">
          {formatShortDateTime(text(start))}–{clockTime(text(end))}
        </span>
      )}
      {proposal.status === 'DONE' && (
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <CheckCircle2 className="size-3.5 text-green-600" aria-hidden />
          已建立
          {proposal.resultUrl && (
            <a href={proposal.resultUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
              在 Google 日曆開啟
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </span>
      )}
      {proposal.status === 'FAILED' && <p className="text-xs text-destructive">{proposal.failureReason ?? '執行失敗'}</p>}
    </li>
  )
}

// The proposals of one finished run. Keyed by the run, so another run's edits never carry over.
function ProposalList({
  run,
  onExecute,
  onRetry,
  isExecuting,
}: {
  run: PostMeetingRun
  onExecute: (proposals: ConfirmedProposal[]) => void
  onRetry: (proposalId: string) => void
  isExecuting: boolean
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  // Waiting proposals start checked; failed ones start unchecked (each has its own 重試).
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(run.proposals.filter((p) => p.status === 'PROPOSED').map((p) => p.id)),
  )
  const draftOf = (proposal: ActionProposal) => drafts[proposal.id] ?? proposal.arguments
  const editable = run.proposals.filter(isEditable)
  const chosen = editable.filter((p) => checked.has(p.id))
  const confirm = (proposal: ActionProposal): ConfirmedProposal => ({ proposalId: proposal.id, arguments: draftOf(proposal) })

  if (run.proposals.length === 0) {
    return <p className="text-sm text-muted-foreground">這場會議沒有需要處理的事項</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {run.proposals.map((proposal) =>
          isEditable(proposal) ? (
            <CalendarEventForm
              key={proposal.id}
              proposal={proposal}
              draft={draftOf(proposal)}
              checked={checked.has(proposal.id)}
              onChange={(draft) => setDrafts((prev) => ({ ...prev, [proposal.id]: draft }))}
              onCheck={(isChecked) =>
                setChecked((prev) => {
                  const next = new Set(prev)
                  if (isChecked) next.add(proposal.id)
                  else next.delete(proposal.id)
                  return next
                })
              }
              // Unchanged: the same values again; edited: carry out just this one with the new values.
              onRetry={() => (drafts[proposal.id] ? onExecute([confirm(proposal)]) : onRetry(proposal.id))}
              isExecuting={isExecuting}
            />
          ) : (
            <ProposalResult key={proposal.id} proposal={proposal} />
          ),
        )}
      </ul>
      {editable.length > 0 && (
        <Button
          size="sm"
          className="w-fit"
          disabled={chosen.length === 0 || chosen.some((p) => problemWith(draftOf(p))) || isExecuting}
          onClick={() => onExecute(chosen.map(confirm))}
        >
          {isExecuting && <Loader2Icon className="size-3.5 animate-spin" />}
          執行勾選的項目
        </Button>
      )}
    </div>
  )
}

interface PostMeetingSectionProps {
  postMeeting: PostMeeting | null
  onStart: () => void
  /** A start request is on its way; one click is one request. */
  isStarting: boolean
  onExecute: (runId: string, proposals: ConfirmedProposal[]) => void
  onRetry: (runId: string, proposalId: string) => void
  isExecuting: boolean
}

// 會後處理 (see ai-service CONTEXT.md): the Studio card that starts the agent on this job and shows what it proposes
// (行動提案). The agent only reads; each proposal is checked and edited by the user, and only carried out once they
// confirm (ai-service ADR 0007).
export function PostMeetingSection({ postMeeting, onStart, isStarting, onExecute, onRetry, isExecuting }: PostMeetingSectionProps) {
  const run = postMeeting?.latestRun ?? null
  const isRunning = run?.status === 'RUNNING'
  return (
    <section aria-labelledby="post-meeting-heading" className="flex flex-col gap-2">
      <h3 id="post-meeting-heading" className="flex items-center gap-2 text-sm font-medium">
        <ClipboardList className="size-4" />
        會後處理
      </h3>
      <p className="text-xs text-muted-foreground">
        讀這場會議、查你的行事曆，把會後該做的事整理成提案；任何改動都要你確認後才會執行。
      </p>
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={!postMeeting?.available || isRunning || isStarting}
        onClick={onStart}
      >
        開始會後處理
      </Button>
      {postMeeting && !postMeeting.available && postMeeting.unavailableReason && (
        <p className="text-xs text-muted-foreground">{postMeeting.unavailableReason}</p>
      )}
      {isRunning && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-3.5 animate-spin" />
          {run.progress ?? '執行中…'}
        </p>
      )}
      {run?.status === 'FAILED' && <p className="text-xs text-destructive">{run.failureReason ?? '會後處理失敗'}</p>}
      {(run?.status === 'COMPLETED' || run?.status === 'LIMIT_REACHED') && (
        <>
          {run.status === 'LIMIT_REACHED' && (
            <p className="text-xs text-muted-foreground">已達上限（工具呼叫次數或時間），以下是已經整理好的提案。</p>
          )}
          <ProposalList
            key={run.id}
            run={run}
            onExecute={(proposals) => onExecute(run.id, proposals)}
            onRetry={(proposalId) => onRetry(run.id, proposalId)}
            isExecuting={isExecuting}
          />
        </>
      )}
    </section>
  )
}
