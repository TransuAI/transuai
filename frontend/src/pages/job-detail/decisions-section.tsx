import { History, Loader2Icon, RefreshCw } from 'lucide-react'
import type { DecisionsActions } from '@/hooks/use-decisions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { speakerNameOrLabel } from '@/lib/speakers'
import { isDecisionsStale } from '@/lib/staleness'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import type { Decision, Transcript } from '@/types/api'

// 決策紀錄 (see ai-service CONTEXT.md「決策」): what was decided in this meeting — why, what else was considered, who
// proposed it, whether it's 暫定 — each with the moment it was made, to listen and check (the AI only keeps decisions
// whose quoted words are really there). Meetings and interviews are extracted once transcribed; anything else on request.
export function DecisionsSection({
  decisions: { decisions, isRequesting, extract },
  transcript,
  onSeek,
  mediaAvailable,
}: {
  decisions: DecisionsActions
  transcript: Transcript | null
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}) {
  const extraction = decisions?.extraction ?? null
  const found = decisions?.decisions ?? []
  const status = extraction?.status ?? 'NONE'
  // Only once it's done: while extracting there's nothing to offer, and a failure already offers 再抽一次.
  const offerAgain = status === 'COMPLETED' && isDecisionsStale(extraction, transcript)
  const nameOf = speakerNameOrLabel(transcript?.speakers ?? [])

  return (
    <section className="flex flex-col gap-3">
      <h3>決策</h3>
      <p className="text-xs text-muted-foreground">
        由 AI 從這場找出與會者做成的決定，附上理由、沒選的選項與做成決定的時間點；點時間聽原話確認。
      </p>

      {status === 'GENERATING' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-4 animate-spin" />
          抽取中…
        </p>
      )}
      {status === 'FAILED' && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-destructive">{extraction?.failureReason ?? '抽取失敗'}</p>
          <Button size="sm" variant="outline" className="w-fit" disabled={isRequesting} onClick={extract}>
            再抽一次
          </Button>
        </div>
      )}
      {status === 'NONE' && (
        <Button size="sm" variant="outline" className="w-fit" disabled={isRequesting} onClick={extract}>
          抽出決策
        </Button>
      )}
      {offerAgain && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <History className="mt-0.5 size-4 shrink-0" />
            逐字稿已修改，這些決策可能過時
          </p>
          <Button size="sm" variant="outline" className="w-fit bg-background" disabled={isRequesting} onClick={extract}>
            <RefreshCw className="size-4" />
            重新抽出
          </Button>
        </div>
      )}

      {found.length > 0 ? (
        <ul aria-label="這場的決策" className="flex flex-col gap-3">
          {found.map((decision) => (
            <DecisionItem
              key={decision.id}
              decision={decision}
              proposer={decision.proposedBy ? nameOf(decision.proposedBy) : null}
              onSeek={onSeek}
              mediaAvailable={mediaAvailable}
            />
          ))}
        </ul>
      ) : (
        status === 'COMPLETED' && <p className="text-sm text-muted-foreground">這場沒有找到做成的決定</p>
      )}
      {found.length > 0 && extraction?.model && (
        <p className="text-xs text-muted-foreground/80">由 {extraction.model} 抽取</p>
      )}
    </section>
  )
}

function DecisionItem({
  decision,
  proposer,
  onSeek,
  mediaAvailable,
}: {
  decision: Decision
  proposer: string | null
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <p className="flex items-start gap-2 font-medium leading-relaxed">
        <span className="flex-1">{decision.statement}</span>
        {decision.tentative && <Badge variant="outline">暫定</Badge>}
      </p>
      {decision.rationale && <p className="text-foreground/85">理由：{decision.rationale}</p>}
      {decision.alternatives.length > 0 && (
        <p className="text-muted-foreground">沒選：{decision.alternatives.join('、')}</p>
      )}
      {proposer && <p className="text-xs text-muted-foreground">提出：{proposer}</p>}
      {decision.startTime !== null && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TimestampButton seconds={decision.startTime} onSeek={onSeek} mediaAvailable={mediaAvailable} />
          {decision.evidenceText && <span className="leading-relaxed">「{decision.evidenceText}」</span>}
        </p>
      )}
    </li>
  )
}
