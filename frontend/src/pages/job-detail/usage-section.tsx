import { useState } from 'react'
import { ChevronDown, Gauge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCount, formatMinutes } from '@/lib/usage-format'
import { cn } from '@/lib/utils'
import type { JobUsage, UsageRecord } from '@/types/api'

const FEATURE_LABELS: Record<string, string> = {
  summary: '摘要',
  chapters: '章節',
  qa_answer: '問答',
  qa_rewrite: '問題改寫',
  regenerated_summary: '重新產生摘要',
  regenerated_chapters: '重新產生章節',
  quiz: '測驗',
  post_meeting: '會後處理',
  transcription: '轉錄',
  web_search: '網路搜尋',
  job_title: '標題',
  speaker_names: '講者名字建議',
  speaker_insights: '講者數據分析',
}

function tokens(value: number) {
  return `${formatCount(value)} tokens`
}

// What one call consumed; each unknown number (the provider didn't report it) shows as 「—」, never 0.
function consumption(record: UsageRecord) {
  if (record.kind === 'web_search') return '1 次'
  if (record.kind === 'transcription') return record.audioSeconds === null ? '—' : formatMinutes(record.audioSeconds)
  const known = (value: number | null) => (value === null ? '—' : formatCount(value))
  return `${known(record.inputTokens)} → ${known(record.outputTokens)} tokens`
}

function hasUnknownNumbers(record: UsageRecord) {
  if (record.kind === 'web_search') return false // a search has no numbers to know
  return record.kind === 'transcription'
    ? record.audioSeconds === null
    : record.inputTokens === null || record.outputTokens === null
}

function clockTime(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

interface FeatureSum {
  label: string
  calls: number
  failed: number
  /** Known tokens (input + output) for model calls, known seconds for transcription; null when none is known. */
  amount: number | null
  kind: UsageRecord['kind']
}

// The calls added up per feature (問答, 摘要, …), in the order each feature was first used.
function sumByFeature(records: UsageRecord[]): FeatureSum[] {
  const sums = new Map<string, FeatureSum>()
  for (const record of records) {
    const label = FEATURE_LABELS[record.feature] ?? record.feature
    const sum = sums.get(label) ?? { label, calls: 0, failed: 0, amount: null, kind: record.kind }
    sum.calls += 1
    if (!record.succeeded) sum.failed += 1
    const known =
      record.kind === 'web_search'
        ? null
        : record.kind === 'transcription'
          ? record.audioSeconds
          : record.inputTokens === null && record.outputTokens === null
            ? null
            : (record.inputTokens ?? 0) + (record.outputTokens ?? 0)
    if (known !== null) sum.amount = (sum.amount ?? 0) + known
    sums.set(label, sum)
  }
  return [...sums.values()]
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-semibold tabular-nums" title={value}>{value}</dd>
    </div>
  )
}

// 用量 (see ai-service CONTEXT.md): the job's totals and what each feature used; every single billed call
// (time, model, numbers) only on request — a job with many questions easily has dozens.
export function UsageSection({ usage }: { usage: JobUsage | null }) {
  const records = usage?.records ?? []
  const [showCalls, setShowCalls] = useState(false)
  return (
    <section aria-labelledby="usage-heading" className="flex flex-col gap-3">
      <h3 id="usage-heading" className="flex items-center gap-2 text-sm font-medium">
        <Gauge className="size-4" />
        用量
      </h3>
      {usage && records.length > 0 ? (
        <>
          <dl className={cn('grid gap-2', usage.totals.audioSeconds > 0 ? 'grid-cols-3' : 'grid-cols-2')}>
            <Stat label="輸入 tokens" value={formatCount(usage.totals.inputTokens)} />
            <Stat label="輸出 tokens" value={formatCount(usage.totals.outputTokens)} />
            {usage.totals.audioSeconds > 0 && <Stat label="轉錄" value={formatMinutes(usage.totals.audioSeconds)} />}
          </dl>
          {/* The totals only add up what's known; say so rather than let them pass as complete. */}
          {records.some(hasUnknownNumbers) && <p className="text-xs text-muted-foreground">部分用量未知，未計入總計</p>}
          <ul aria-label="依功能" className="flex flex-col divide-y text-sm">
            {sumByFeature(records).map((sum) => (
              <li key={sum.label} className="flex items-baseline gap-2 py-2 first:pt-0">
                <span className="font-medium">{sum.label}</span>
                <span className="text-xs text-muted-foreground">
                  {sum.calls} 次{sum.failed > 0 && <span className="text-destructive"> · {sum.failed} 次失敗</span>}
                </span>
                <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
                  {/* A web search has nothing to show but how many times, which the row already says. */}
                  {sum.kind === 'web_search'
                    ? ''
                    : sum.amount === null
                      ? '—'
                      : sum.kind === 'transcription'
                        ? formatMinutes(sum.amount)
                        : tokens(sum.amount)}
                </span>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showCalls}
            onClick={() => setShowCalls((shown) => !shown)}
            className="-ml-2 w-fit text-muted-foreground"
          >
            <ChevronDown className={cn('size-4 transition-transform', showCalls && 'rotate-180')} />
            {showCalls ? '收起每一次呼叫' : `每一次呼叫（${records.length}）`}
          </Button>
          {showCalls && (
            // One line per call in fixed columns (time, feature, model, numbers): a long model name is cut
            // short (the whole name on hover) rather than pushing the numbers onto a line of their own.
            <ul aria-label="每一次呼叫" className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 text-xs">
              {records.map((record, i) => (
                // Records have no id of their own; the list only ever grows at the end.
                <li
                  key={`${record.createdAt}-${i}`}
                  className="col-span-4 grid grid-cols-subgrid items-baseline text-muted-foreground"
                >
                  <span className="font-mono tabular-nums">{clockTime(record.createdAt)}</span>
                  <span className="whitespace-nowrap text-foreground">{FEATURE_LABELS[record.feature] ?? record.feature}</span>
                  {/* A web search has no model: its service (tavily) instead. */}
                  <span title={record.model || record.provider} className="truncate">
                    {record.model || record.provider}
                  </span>
                  <span className="text-right font-mono whitespace-nowrap tabular-nums">
                    {consumption(record)}
                    {!record.succeeded && <span className="ml-1.5 font-sans text-destructive">失敗</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">尚無用量紀錄</p>
      )}
    </section>
  )
}
