import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  CircleCheck,
  CircleSlash,
  Download,
  ExternalLink,
  History,
  Loader2Icon,
  RefreshCw,
  SearchCheck,
  SearchX,
  type LucideIcon,
} from 'lucide-react'
import type { FactCheckActions } from '@/hooks/use-fact-check'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { KIND_LABELS, VERDICT_LABELS } from '@/lib/claims'
import { downloadTextFile, fileNameWithSuffix } from '@/lib/download'
import { buildFactCheckExport, FACT_CHECK_MARKDOWN, toFactCheckMarkdown } from '@/lib/export-formats'
import { speakerNameOrLabel } from '@/lib/speakers'
import { siteOf, WEB_LINK } from '@/lib/web-sources'
import { isClaimStale, isFactCheckStale } from '@/lib/staleness'
import { cn } from '@/lib/utils'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import type { Claim, Transcript } from '@/types/api'

// The verdicts read apart by icon and word, not by a right/wrong red and green: a verdict is what the pages found say, not a
// ruling on who's right.
const VERDICT_ICONS: Record<NonNullable<Claim['verdict']>, LucideIcon> = {
  supported: CircleCheck,
  disputed: ArrowLeftRight,
  no_reliable_source: SearchX,
  not_checkable: CircleSlash,
}

// 事實查核 (see ai-service CONTEXT.md「主張」「查核」): the numbers and statements about the outside world said in the
// recording, each with who said it and where — found by AI without spending any web searches. What only the speaker can
// know is marked 無法查核. The claims ticked are then checked: one web search each (sharing this month's searches with 問答's
// 查網路), the verdict judged by AI from the pages found, with those pages as its sources.
export function FactCheckSection({
  factCheck: { factCheck, isRequesting, find, isSendingCheck, check },
  webSearchAvailable,
  webSearchesLeft,
  transcript,
  onSeek,
  mediaAvailable,
  claimToOpen = null,
  onClaimOpened = () => {},
  fileName,
  jobTitle = null,
}: {
  factCheck: FactCheckActions
  /** Whether this deployment can search the web, and how many searches are left this month (null: unknown). */
  webSearchAvailable: boolean
  webSearchesLeft: number | null
  transcript: Transcript | null
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  /** A claim picked in the transcript: scrolled to and briefly highlighted. */
  claimToOpen?: string | null
  onClaimOpened?: () => void
  /** What the exported Markdown is named after and headed by. */
  fileName: string
  jobTitle?: string | null
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

  // Ticked to be checked: only what can be (not 無法查核, not being checked now) while there are searches left. The claims
  // being checked will each use one too (maybe not counted yet), so they're taken off what's left.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const beingChecked = claims.filter((claim) => claim.checking).length
  const searchesLeft = webSearchesLeft === null ? null : Math.max(0, webSearchesLeft - beingChecked)
  const searchesUsedUp = searchesLeft === 0
  const hasBox = (claim: Claim) => webSearchAvailable && claim.verdict !== 'not_checkable' && !claim.checking
  const canTick = (claim: Claim) => hasBox(claim) && !searchesUsedUp
  const ticked = claims.filter((claim) => selected.has(claim.id) && canTick(claim))
  const tooMany = searchesLeft !== null && ticked.length > searchesLeft
  const leftNote = searchesLeft !== null ? `，本月還剩 ${searchesLeft} 次` : ''
  const checkable = claims.some((claim) => claim.verdict !== 'not_checkable')
  const anyChecked = claims.some((claim) => claim.verdict && claim.verdict !== 'not_checkable')
  const tick = (claimId: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(claimId)
      else next.delete(claimId)
      return next
    })
  const download = () => {
    if (!factCheck) return
    downloadTextFile({
      fileName: fileNameWithSuffix(fileName, FACT_CHECK_MARKDOWN.fileSuffix),
      content: toFactCheckMarkdown(buildFactCheckExport({ fileName, title: jobTitle }, factCheck, transcript)),
      mimeType: FACT_CHECK_MARKDOWN.mimeType,
    })
  }
  const checkTicked = () => {
    void check(ticked.map((claim) => claim.id)).then((started) => {
      if (started) setSelected(new Set())
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <h3>事實查核</h3>
      <p className="text-xs text-muted-foreground">
        由 AI 找出錄音裡可以查核的數字與說法，標出是誰在哪裡說的；這一步不會用到網路搜尋。只有說話者自己知道的事標為「無法查核」。
        勾選要查的主張後，每條會查一次網路（跟問答的「查網路」共用每月次數），由 AI 依搜到的網頁給出結論。
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
              tick={
                hasBox(claim)
                  ? { checked: selected.has(claim.id) && canTick(claim), disabled: !canTick(claim), onChange: tick }
                  : null
              }
            />
          ))}
        </ul>
      ) : (
        status === 'COMPLETED' && <p className="text-sm text-muted-foreground">這場沒有找到可以查核的數字或說法</p>
      )}

      {checkable &&
        (!webSearchAvailable ? (
          <p className="text-xs text-muted-foreground">這個部署沒有設定網路搜尋，無法查核</p>
        ) : searchesUsedUp ? (
          <p className="text-xs text-muted-foreground">這個月的網路搜尋已用完，下個月 1 日恢復；找出主張照常可以用</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p aria-live="polite" className={cn('flex-1', tooMany && 'text-destructive')}>
              {ticked.length === 0
                ? `勾選要查核的主張，每條會用掉 1 次網路搜尋${leftNote}`
                : tooMany
                  ? `勾了 ${ticked.length} 條，本月只剩 ${searchesLeft} 次網路搜尋，請少勾幾條`
                  : `會用掉 ${ticked.length} 次網路搜尋${leftNote}`}
            </p>
            <Button size="sm" disabled={ticked.length === 0 || tooMany || isSendingCheck} onClick={checkTicked}>
              <SearchCheck className="size-4" />
              {ticked.length === 0 ? '查核' : `查核 ${ticked.length} 條`}
            </Button>
          </div>
        ))}
      {anyChecked && <p className="text-xs text-muted-foreground">AI 依網路搜尋整理，請自行確認來源</p>}
      {claims.length > 0 && (
        <Button size="sm" variant="outline" className="w-fit" onClick={download}>
          <Download className="size-4" />
          下載 Markdown
        </Button>
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
  tick,
}: {
  claim: Claim
  speaker: string | null
  stale: boolean
  highlighted: boolean
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  /** Its box for ticking it to be checked; null when it can't be (無法查核, being checked, no web search here). */
  tick: { checked: boolean; disabled: boolean; onChange: (claimId: string, on: boolean) => void } | null
}) {
  const VerdictIcon = claim.verdict ? VERDICT_ICONS[claim.verdict] : null
  return (
    <li
      data-claim-id={claim.id}
      data-highlighted={highlighted || undefined}
      className={cn('flex flex-col gap-1.5 rounded-lg border p-3 text-sm transition-colors', highlighted && 'bg-primary/10')}
    >
      <div className="flex items-start gap-2">
        {tick && (
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            aria-label={`查核：${claim.claim}`}
            checked={tick.checked}
            disabled={tick.disabled}
            onChange={(event) => tick.onChange(claim.id, event.target.checked)}
          />
        )}
        <p className="flex-1 font-medium leading-relaxed">{claim.claim}</p>
        <span className="flex shrink-0 items-center gap-1">
          <Badge variant="outline">{KIND_LABELS[claim.kind]}</Badge>
          {claim.verdict && VerdictIcon && (
            <Badge variant="secondary">
              <VerdictIcon />
              {VERDICT_LABELS[claim.verdict]}
            </Badge>
          )}
        </span>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <TimestampButton seconds={claim.startTime} onSeek={onSeek} mediaAvailable={mediaAvailable} />
        <span className="leading-relaxed">
          {speaker && `${speaker}：`}「{claim.text}」
        </span>
      </p>
      {claim.checking && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          查核中…
        </p>
      )}
      {!claim.checking && claim.checkError && <p className="text-xs text-destructive">查核失敗：{claim.checkError}</p>}
      {claim.explanation && claim.verdict !== 'not_checkable' && (
        <p className="leading-relaxed">{claim.explanation}</p>
      )}
      {claim.sources.length > 0 && (
        <ol aria-label="查核來源" className="flex flex-col gap-1 text-xs">
          {claim.sources.map((source, index) => (
            <li key={`${index}-${source.url}`} className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-muted-foreground tabular-nums">[{index + 1}]</span>
              <a
                href={source.url}
                {...WEB_LINK}
                title={source.excerpt ?? undefined}
                className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                <span className="truncate">{source.title || siteOf(source.url)}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
              <span className="shrink-0 text-muted-foreground">{siteOf(source.url)}</span>
            </li>
          ))}
        </ol>
      )}
      {claim.checkModel && claim.verdict && claim.verdict !== 'not_checkable' && (
        <p className="text-xs text-muted-foreground/80">由 {claim.checkModel} 查核</p>
      )}
      {stale && <p className="text-xs text-muted-foreground">依據舊版逐字稿</p>}
    </li>
  )
}
