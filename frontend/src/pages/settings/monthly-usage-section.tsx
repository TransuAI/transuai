import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Gauge } from 'lucide-react'
import { toast } from 'sonner'
import { usageApi } from '@/lib/api'
import { modelLabel } from '@/lib/providers'
import { formatCount, formatMinutes } from '@/lib/usage-format'
import { Button } from '@/components/ui/button'
import type { MonthlyUsage } from '@/types/api'

// "2026-09" moved by `delta` months.
function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  const index = year * 12 + (monthNumber - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

function monthTitle(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${year} 年 ${monthNumber} 月`
}

interface UsageRow {
  key: string
  label: string
  amount: string
  callsWithUnknownUsage: number
}

function UsageGroup({ title, rows }: { title: string; rows: UsageRow[] }) {
  if (rows.length === 0) return null
  const titleId = `usage-group-${title}`
  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-1.5">
      <h3 id={titleId} className="text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-baseline gap-x-3">
            <span className="break-all">{row.label}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{row.amount}</span>
            {/* The sums only add up what's known; say so rather than let them pass as complete. */}
            {row.callsWithUnknownUsage > 0 && (
              <span className="w-full text-xs text-muted-foreground">其中 {row.callsWithUnknownUsage} 次用量未知，未計入</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// 用量 (see ai-service CONTEXT.md) over one month, per model: what the user's own provider bills will roughly
// show, and how much of the platform model they used. Opens on the current month, which the server decides.
export function MonthlyUsageSection() {
  const [usage, setUsage] = useState<MonthlyUsage | null>(null)
  const [currentMonth, setCurrentMonth] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [failedToOpen, setFailedToOpen] = useState(false)

  const load = (month?: string) => {
    setIsLoading(true)
    setFailedToOpen(false)
    usageApi
      .getMonthly(month)
      .then((loaded) => {
        setUsage(loaded)
        if (!month) setCurrentMonth(loaded.month)
      })
      .catch(() => {
        toast.error('無法載入用量')
        if (!month) setFailedToOpen(true)
      })
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  // Anything not on the platform model was paid with an own key.
  const llmRows = (onPlatform: boolean, label: (provider: string, model: string) => string): UsageRow[] =>
    (usage?.llm ?? [])
      .filter((sum) => (sum.keySource === 'platform') === onPlatform)
      .map((sum) => ({
        key: `${sum.provider}/${sum.model}`,
        label: label(sum.provider, sum.model),
        amount: `輸入 ${formatCount(sum.inputTokens)} · 輸出 ${formatCount(sum.outputTokens)} tokens · ${sum.calls} 次`,
        callsWithUnknownUsage: sum.callsWithUnknownUsage,
      }))
  const transcriptionRows: UsageRow[] = (usage?.transcription ?? []).map((sum) => ({
    key: `${sum.provider}/${sum.model}`,
    label: sum.model,
    amount: `${formatMinutes(sum.audioSeconds)} · ${sum.calls} 次`,
    callsWithUnknownUsage: sum.callsWithUnknownUsage,
  }))
  const isEmpty = usage !== null && usage.llm.length === 0 && usage.transcription.length === 0

  return (
    <section aria-labelledby="monthly-usage-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="monthly-usage-heading" className="flex items-center gap-2 text-base font-medium">
          <Gauge className="size-4" />
          本月用量
        </h2>
        {usage && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="上個月"
              disabled={isLoading}
              onClick={() => load(shiftMonth(usage.month, -1))}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-24 text-center text-sm">{monthTitle(usage.month)}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="下個月"
              disabled={isLoading || usage.month === currentMonth}
              onClick={() => load(shiftMonth(usage.month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      {failedToOpen && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          無法載入用量
          <Button variant="outline" size="sm" disabled={isLoading} onClick={() => load()}>
            重試
          </Button>
        </div>
      )}
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">這個月沒有用量</p>
      ) : (
        <>
          <UsageGroup title="平台模型" rows={llmRows(true, (_provider, model) => model)} />
          <UsageGroup title="自有金鑰" rows={llmRows(false, (provider, model) => modelLabel({ provider, model }))} />
          <UsageGroup title="轉錄" rows={transcriptionRows} />
        </>
      )}
    </section>
  )
}
