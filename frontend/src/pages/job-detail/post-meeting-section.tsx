import { CalendarPlus, ClipboardList, Loader2Icon } from 'lucide-react'
import { formatShortDateTime } from '@/lib/media'
import { Button } from '@/components/ui/button'
import type { ActionProposal, PostMeeting } from '@/types/api'

function clockTime(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

// One proposal, read-only for now (confirming and carrying them out comes later).
function ProposalItem({ proposal }: { proposal: ActionProposal }) {
  if (proposal.kind === 'calendar_event') {
    const { summary, start, end, description } = proposal.arguments
    return (
      <li className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarPlus className="size-3.5" />
          行事曆活動
        </span>
        <span className="font-medium">{text(summary)}</span>
        <span className="text-xs text-muted-foreground">
          {formatShortDateTime(text(start))}–{clockTime(text(end))}
        </span>
        {text(description) && <p className="text-xs text-muted-foreground">{text(description)}</p>}
      </li>
    )
  }
  return (
    <li className="rounded-md border px-3 py-2 text-sm">
      {proposal.kind}：{JSON.stringify(proposal.arguments)}
    </li>
  )
}

interface PostMeetingSectionProps {
  postMeeting: PostMeeting | null
  onStart: () => void
  /** A start request is on its way; one click is one request. */
  isStarting: boolean
}

// 會後處理 (see ai-service CONTEXT.md): the Studio card that starts the agent on this job and shows what it proposes
// (行動提案). The agent only reads; anything it would change waits for the user.
export function PostMeetingSection({ postMeeting, onStart, isStarting }: PostMeetingSectionProps) {
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
          {run.proposals.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {run.proposals.map((proposal) => (
                <ProposalItem key={proposal.id} proposal={proposal} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">這場會議沒有需要處理的事項</p>
          )}
        </>
      )}
    </section>
  )
}
