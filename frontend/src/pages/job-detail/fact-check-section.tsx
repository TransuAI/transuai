import { useEffect, useRef, useState } from 'react'
import { History, Loader2Icon, RefreshCw } from 'lucide-react'
import type { FactCheckActions } from '@/hooks/use-fact-check'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { KIND_LABELS, VERDICT_LABELS } from '@/lib/claims'
import { speakerNameOrLabel } from '@/lib/speakers'
import { isClaimStale, isFactCheckStale } from '@/lib/staleness'
import { cn } from '@/lib/utils'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import type { Claim, Transcript } from '@/types/api'

// 事實查核 (see ai-service CONTEXT.md「主張」「查核」): the numbers and statements about the outside world said in the
// recording, each with who said it and where — found by AI without spending any web searches. What only the speaker can
// know is marked 無法查核.
export function FactCheckSection({
  factCheck: { factCheck, isRequesting, find },
  transcript,
  onSeek,
  mediaAvailable,
  claimToOpen = null,
  onClaimOpened = () => {},
}: {
  factCheck: FactCheckActions
  transcript: Transcript | null
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  /** A claim picked in the transcript: scrolled to and briefly highlighted. */
  claimToOpen?: string | null
  onClaimOpened?: () => void
}) {
  // As notes: the claim just opened from elsewhere, briefly highlighted so the eye finds it in the list.
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!claimToOpen) return
    setHighlightedId(claimToOpen)
    onClaimOpened()
  }, [claimToOpen, onClaimOpened])
  useEffect(() => {
    if (!highlightedId) return
    listRef.current?.querySelector(`[data-claim-id="${highlightedId}"]`)?.scrollIntoView?.({ block: 'nearest' })
    const timer = setTimeout(() => setHighlightedId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightedId])

  const extraction = factCheck?.extraction ?? null
  const claims = factCheck?.claims ?? []
  const status = extraction?.status ?? 'NONE'
  const stale = status === 'COMPLETED' && isFactCheckStale(extraction, transcript)
  const nameOf = speakerNameOrLabel(transcript?.speakers ?? [])

  return (
    <section className="flex flex-col gap-3">
      <h3>事實查核</h3>
      <p className="text-xs text-muted-foreground">
        由 AI 找出錄音裡可以查核的數字與說法，標出是誰在哪裡說的；這一步不會用到網路搜尋。只有說話者自己知道的事標為「無法查核」。
      </p>

      {status === 'GENERATING' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-4 animate-spin" />
          找主張中…
        </p>
      )}
      {status === 'FAILED' && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-destructive">{extraction?.failureReason ?? '找主張失敗'}</p>
          <Button size="sm" variant="outline" className="w-fit" disabled={isRequesting} onClick={find}>
            再找一次
          </Button>
        </div>
      )}
      {status === 'NONE' && (
        <Button size="sm" variant="outline" className="w-fit" disabled={isRequesting} onClick={find}>
          找出主張
        </Button>
      )}
      {stale && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <History className="mt-0.5 size-4 shrink-0" />
            逐字稿已修改，這些主張可能過時
          </p>
          <Button size="sm" variant="outline" className="w-fit bg-background" disabled={isRequesting} onClick={find}>
            <RefreshCw className="size-4" />
            重新找出
          </Button>
        </div>
      )}

      {claims.length > 0 ? (
        <ul ref={listRef} aria-label="這場的主張" className="flex flex-col gap-3">
          {claims.map((claim) => (
            <ClaimItem
              key={claim.id}
              claim={claim}
              speaker={claim.speakerLabel ? nameOf(claim.speakerLabel) : null}
              stale={isClaimStale(claim, transcript)}
              highlighted={claim.id === highlightedId}
              onSeek={onSeek}
              mediaAvailable={mediaAvailable}
            />
          ))}
        </ul>
      ) : (
        status === 'COMPLETED' && <p className="text-sm text-muted-foreground">這場沒有找到可以查核的數字或說法</p>
      )}

      {status === 'COMPLETED' && !stale && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/80">
          {extraction?.model && <span>由 {extraction.model} 標出</span>}
          <Button size="xs" variant="ghost" disabled={isRequesting} onClick={find}>
            <RefreshCw className="size-3.5" />
            重新找出
          </Button>
        </div>
      )}
    </section>
  )
}

function ClaimItem({
  claim,
  speaker,
  stale,
  highlighted,
  onSeek,
  mediaAvailable,
}: {
  claim: Claim
  speaker: string | null
  stale: boolean
  highlighted: boolean
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}) {
  return (
    <li
      data-claim-id={claim.id}
      data-highlighted={highlighted || undefined}
      className={cn('flex flex-col gap-1.5 rounded-lg border p-3 text-sm transition-colors', highlighted && 'bg-primary/10')}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium leading-relaxed">{claim.claim}</p>
        <span className="flex shrink-0 items-center gap-1">
          <Badge variant="outline">{KIND_LABELS[claim.kind]}</Badge>
          {claim.verdict && <Badge variant="secondary">{VERDICT_LABELS[claim.verdict]}</Badge>}
        </span>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <TimestampButton seconds={claim.startTime} onSeek={onSeek} mediaAvailable={mediaAvailable} />
        <span className="leading-relaxed">
          {speaker && `${speaker}：`}「{claim.text}」
        </span>
      </p>
      {stale && <p className="text-xs text-muted-foreground">依據舊版逐字稿</p>}
    </li>
  )
}
