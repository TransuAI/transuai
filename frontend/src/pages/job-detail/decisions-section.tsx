import { useEffect, useRef, useState, type FormEvent } from 'react'
import { History, Loader2Icon, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { DecisionsActions } from '@/hooks/use-decisions'
import { ApiError } from '@/lib/api-client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/media'
import { speakerNameOrLabel, speakersWithSegments } from '@/lib/speakers'
import { isDecisionsStale } from '@/lib/staleness'
import { cn } from '@/lib/utils'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import type { Decision, DecisionInput, Speaker, Transcript } from '@/types/api'

const NOT_SAVED = '決策沒有存到，請再試一次'
const FIELD =
  'w-full rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60'

// 決策紀錄 (see ai-service CONTEXT.md「決策」): what was decided in this meeting — why, what else was considered, who
// proposed it, whether it's 暫定 — each with the moment it was made, to listen and check (the AI only keeps decisions
// whose quoted words are really there). Meetings and interviews are extracted once transcribed; anything else on request.
// The user can correct, delete and add decisions; extracting again keeps all of that.
export function DecisionsSection({
  decisions: actions,
  transcript,
  onSeek,
  mediaAvailable,
  currentTime,
  decisionToOpen = null,
  onDecisionOpened = () => {},
}: {
  decisions: DecisionsActions
  transcript: Transcript | null
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  /** Where playback is now, for a decision the user adds; null without a player. */
  currentTime: () => number | null
  /** A decision picked elsewhere (講者數據): scrolled to and briefly highlighted. */
  decisionToOpen?: string | null
  onDecisionOpened?: () => void
}) {
  const { decisions, isRequesting, extract } = actions
  // As notes: the decision just opened from elsewhere, briefly highlighted so the eye finds it in the list.
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!decisionToOpen) return
    setHighlightedId(decisionToOpen)
    onDecisionOpened()
  }, [decisionToOpen, onDecisionOpened])
  useEffect(() => {
    if (!highlightedId) return
    listRef.current?.querySelector(`[data-decision-id="${highlightedId}"]`)?.scrollIntoView?.({ block: 'nearest' })
    const timer = setTimeout(() => setHighlightedId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightedId])

  const [editingId, setEditingId] = useState<string | null>(null)
  // Adding: where playback was when the user started, to offer pinning the decision there.
  const [adding, setAdding] = useState<{ time: number | null } | null>(null)
  const [deleting, setDeleting] = useState<Decision | null>(null)

  const extraction = decisions?.extraction ?? null
  const found = decisions?.decisions ?? []
  const status = extraction?.status ?? 'NONE'
  // Only once it's done: while extracting there's nothing to offer, and a failure already offers 再抽一次.
  const offerAgain = status === 'COMPLETED' && isDecisionsStale(extraction, transcript)
  const nameOf = speakerNameOrLabel(transcript?.speakers ?? [])
  const speakers = transcript ? speakersWithSegments(transcript.segments, transcript.speakers) : []

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await actions.remove(deleting.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '無法刪除決策，請稍後再試')
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3>決策</h3>
      <p className="text-xs text-muted-foreground">
        由 AI 從這場找出與會者做成的決定，附上理由、沒選的選項與做成決定的時間點；點時間聽原話確認。抽錯的可以修改或刪除、漏掉的可以自己新增，重新抽出時都會保留。
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
        <ul ref={listRef} aria-label="這場的決策" className="flex flex-col gap-3">
          {found.map((decision) =>
            decision.id === editingId ? (
              <li key={decision.id} data-decision-id={decision.id}>
                <DecisionForm
                  label="修改決策"
                  initial={decision}
                  speakers={speakers}
                  time={null}
                  onSave={async (input) => {
                    await actions.update(decision.id, input)
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <DecisionItem
                key={decision.id}
                decision={decision}
                proposer={decision.proposedBy ? nameOf(decision.proposedBy) : null}
                highlighted={decision.id === highlightedId}
                onSeek={onSeek}
                mediaAvailable={mediaAvailable}
                onEdit={() => setEditingId(decision.id)}
                onDelete={() => setDeleting(decision)}
              />
            ),
          )}
        </ul>
      ) : (
        status === 'COMPLETED' && <p className="text-sm text-muted-foreground">這場沒有找到做成的決定</p>
      )}

      {adding ? (
        <DecisionForm
          label="新增決策"
          initial={null}
          speakers={speakers}
          time={adding.time}
          onSave={async (input) => {
            await actions.create(input)
            setAdding(null)
          }}
          onCancel={() => setAdding(null)}
        />
      ) : (
        <Button size="sm" variant="ghost" className="w-fit" onClick={() => setAdding({ time: currentTime() })}>
          <Plus className="size-4" />
          新增決策
        </Button>
      )}

      {found.length > 0 && extraction?.model && (
        <p className="text-xs text-muted-foreground/80">由 {extraction.model} 抽取</p>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除這個決策？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.source === 'user' ? '這是你自己新增的決策，刪除後無法復原。' : '刪除後重新抽出決策時，它也不會再出現。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>刪除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function DecisionItem({
  decision,
  proposer,
  highlighted,
  onSeek,
  mediaAvailable,
  onEdit,
  onDelete,
}: {
  decision: Decision
  proposer: string | null
  highlighted: boolean
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li
      data-decision-id={decision.id}
      data-highlighted={highlighted || undefined}
      className={cn('flex flex-col gap-1.5 rounded-lg border p-3 text-sm transition-colors', highlighted && 'bg-primary/10')}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium leading-relaxed">{decision.statement}</p>
        <span className="flex shrink-0 items-center gap-1">
          {decision.tentative && <Badge variant="outline">暫定</Badge>}
          {decision.source === 'user' ? (
            <Badge variant="secondary">自己新增</Badge>
          ) : (
            decision.edited && <Badge variant="secondary">已修改</Badge>
          )}
          <Button size="icon-xs" variant="ghost" aria-label="修改" title="修改" onClick={onEdit}>
            <Pencil />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="刪除" title="刪除" onClick={onDelete}>
            <Trash2 />
          </Button>
        </span>
      </div>
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

// Writing a decision: what was decided, why, what else was considered (one per line), who proposed it, whether it's
// 暫定 — and, when adding one with a player, whether to pin it to where playback was. A failed save keeps what was typed.
function DecisionForm({
  label,
  initial,
  speakers,
  time,
  onSave,
  onCancel,
}: {
  label: string
  /** The decision being edited; null when adding. */
  initial: Decision | null
  speakers: Speaker[]
  /** Where playback was when adding started; null when editing (the time stays as it was) or without a player. */
  time: number | null
  /** Rejects when saving fails. */
  onSave: (input: DecisionInput) => Promise<void>
  onCancel: () => void
}) {
  const [statement, setStatement] = useState(initial?.statement ?? '')
  const [rationale, setRationale] = useState(initial?.rationale ?? '')
  const [alternatives, setAlternatives] = useState(initial?.alternatives.join('\n') ?? '')
  const [proposedBy, setProposedBy] = useState(initial?.proposedBy ?? '')
  const [tentative, setTentative] = useState(initial?.tentative ?? false)
  const [pinned, setPinned] = useState(time !== null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || !statement.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        statement: statement.trim(),
        rationale: rationale.trim(),
        alternatives: alternatives
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        proposedBy: proposedBy || null,
        tentative,
        ...(initial === null && { startTime: pinned ? time : null }),
      })
    } catch (err) {
      // A rule the decision breaks comes with the reason; anything else is just "try again".
      setError(err instanceof ApiError && err.status === 400 ? err.message : NOT_SAVED)
      setSaving(false)
    }
  }

  return (
    <form
      aria-label={label}
      // Esc here cancels; the Studio Sheet must not treat it as "close" (see completed-workspace.tsx).
      data-consumes-escape=""
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">決定</span>
        <textarea
          aria-label="決定"
          autoFocus
          rows={2}
          maxLength={300}
          value={statement}
          disabled={saving}
          onChange={(event) => setStatement(event.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">理由</span>
        <textarea
          aria-label="理由"
          rows={2}
          maxLength={1000}
          value={rationale}
          disabled={saving}
          onChange={(event) => setRationale(event.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">沒選的選項（一行一個）</span>
        <textarea
          aria-label="沒選的選項（一行一個）"
          rows={2}
          value={alternatives}
          disabled={saving}
          onChange={(event) => setAlternatives(event.target.value)}
          className={FIELD}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">提出的人</span>
          <select
            aria-label="提出的人"
            value={proposedBy}
            disabled={saving}
            onChange={(event) => setProposedBy(event.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">不確定是誰</option>
            {speakers.map((speaker) => (
              <option key={speaker.label} value={speaker.label}>
                {speaker.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={tentative}
            disabled={saving}
            onChange={(event) => setTentative(event.target.checked)}
          />
          暫定
        </label>
        {initial === null && time !== null && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={pinned} disabled={saving} onChange={(event) => setPinned(event.target.checked)} />
            {`附上目前播放的時間（${formatDuration(time)}）`}
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="xs" variant="ghost" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" size="xs" disabled={saving || !statement.trim()}>
          儲存
        </Button>
      </div>
    </form>
  )
}
