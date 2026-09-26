import { Gauge } from 'lucide-react'
import { formatCount, formatMinutes } from '@/lib/usage-format'
import type { JobUsage, UsageRecord } from '@/types/api'

const FEATURE_LABELS: Record<string, string> = {
  summary: '摘要',
  chapters: '章節',
  qa_answer: '問答',
  qa_rewrite: '問題改寫',
  regenerated_summary: '重新產生摘要',
  regenerated_chapters: '重新產生章節',
  transcription: '轉錄',
}

function tokens(value: number) {
  return `${formatCount(value)} tokens`
}

// What one call consumed; each unknown number (the provider didn't report it) shows as 「—」, never 0.
function consumption(record: UsageRecord) {
  if (record.kind === 'transcription') return record.audioSeconds === null ? '—' : formatMinutes(record.audioSeconds)
  const known = (value: number | null) => (value === null ? '—' : formatCount(value))
  return `${known(record.inputTokens)} → ${known(record.outputTokens)} tokens`
}

function hasUnknownNumbers(record: UsageRecord) {
  return record.kind === 'transcription'
    ? record.audioSeconds === null
    : record.inputTokens === null || record.outputTokens === null
}

function clockTime(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// 用量 (see ai-service CONTEXT.md): every billed call made for this job, with the totals.
export function UsageSection({ usage }: { usage: JobUsage | null }) {
  const records = usage?.records ?? []
  return (
    <section aria-labelledby="usage-heading" className="flex flex-col gap-2">
      <h3 id="usage-heading" className="flex items-center gap-2 text-sm font-medium">
        <Gauge className="size-4" />
        用量
      </h3>
      {usage && records.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            輸入 {tokens(usage.totals.inputTokens)} · 輸出 {tokens(usage.totals.outputTokens)}
            {usage.totals.audioSeconds > 0 && ` · 轉錄 ${formatMinutes(usage.totals.audioSeconds)}`}
            {/* The totals only add up what's known; say so rather than let them pass as complete. */}
            {records.some(hasUnknownNumbers) && '（部分用量未知，未計入）'}
          </p>
          <ul className="flex flex-col gap-1.5 text-xs">
            {records.map((record, i) => (
              // Records have no id of their own; the list only ever grows at the end.
              <li key={`${record.createdAt}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
                <span className="font-mono">{clockTime(record.createdAt)}</span>
                <span className="text-foreground">{FEATURE_LABELS[record.feature] ?? record.feature}</span>
                <span className="break-all">{record.model}</span>
                <span className="ml-auto font-mono">{consumption(record)}</span>
                {!record.succeeded && <span className="text-destructive">失敗</span>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">尚無用量紀錄</p>
      )}
    </section>
  )
}
