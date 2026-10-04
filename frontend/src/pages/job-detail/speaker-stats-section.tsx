import { History, Loader2Icon, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SpeakerInsightsActions } from '@/hooks/use-speaker-insights'
import { formatClock } from '@/lib/export-formats'
import { speakerColour, speakerNameOrLabel } from '@/lib/speakers'
import { insightsByKind, type MeetingStats } from '@/lib/speaker-stats'
import { hasSpeakerInsightResults, isSpeakerInsightsStale } from '@/lib/staleness'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import type { JobDecisions, SpeakerInsight, Transcript } from '@/types/api'

// 講者數據 (.scratch/speaker-analytics): who talked how much, worked out straight from the transcript, so it follows
// speaker edits at once. Only shown with two or more speakers (the tile isn't there otherwise).
export function SpeakerStatsSection({
  stats,
  transcript,
  insights,
  decisions,
  onOpenDecision,
  onSeek,
  mediaAvailable,
}: {
  stats: MeetingStats
  transcript: Transcript
  insights: SpeakerInsightsActions
  /** 決策紀錄 of this job; null until loaded. */
  decisions: JobDecisions | null
  /** Opens 決策 at that decision, or just opens it (null) to extract them. */
  onOpenDecision: (decisionId: string | null) => void
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}) {
  // Only once extracted (at least once): before that there's no count to give, not even zero.
  const extracted = decisions?.extraction?.completedAt ? decisions.decisions : null
  const proposedBy = new Map<string, number>()
  for (const decision of extracted ?? []) {
    if (decision.proposedBy) proposedBy.set(decision.proposedBy, (proposedBy.get(decision.proposedBy) ?? 0) + 1)
  }

  return (
    <section className="flex flex-col gap-4">
      <h3>講者數據</h3>

      <div className="flex flex-col gap-2" aria-hidden>
        {stats.speakers.map((row) => (
          <div key={row.speaker.label} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 truncate text-muted-foreground">{row.speaker.displayName}</span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{ width: `${row.share * 100}%`, backgroundColor: speakerColour(row.speaker) }}
              />
            </span>
            <span className="w-9 shrink-0 text-right tabular-nums">{percent(row.share)}</span>
          </div>
        ))}
      </div>

      <table aria-label="每位講者的發言" className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 text-left font-normal">講者</th>
            <th scope="col" className="py-1 pl-3 text-right font-normal">發言時間</th>
            <th scope="col" className="py-1 pl-3 text-right font-normal">佔比</th>
            <th scope="col" className="py-1 pl-3 text-right font-normal">次數</th>
            <th scope="col" className="py-1 pl-3 text-right font-normal">最長一次</th>
            <th scope="col" className="py-1 pl-3 text-right font-normal">平均</th>
            {extracted && <th scope="col" className="py-1 pl-3 text-right font-normal">決策</th>}
          </tr>
        </thead>
        <tbody>
          {stats.speakers.map((row) => (
            <tr key={row.speaker.label} className="border-t">
              <th scope="row" className="py-1.5 text-left font-normal">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: speakerColour(row.speaker) }}
                  />
                  {row.speaker.displayName}
                  {row.quiet && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">發言很少</span>
                  )}
                </span>
              </th>
              <td className="py-1.5 pl-3 text-right tabular-nums">{formatClock(row.talkSeconds)}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums">{percent(row.share)}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums">{row.turns}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums">{formatClock(row.longestTurnSeconds)}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums">{formatClock(row.averageTurnSeconds)}</td>
              {extracted && (
                <td className="py-1.5 pl-3 text-right tabular-nums">{proposedBy.get(row.speaker.label) ?? 0}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        <li>{`換人 ${stats.speakerChanges} 次`}</li>
        {stats.silenceSeconds > 0 && <li>{`無人說話共 ${formatClock(stats.silenceSeconds)}`}</li>}
      </ul>
      <p className="text-xs text-muted-foreground/80">
        依逐字稿的時間計算；講者分得不對時，改片段的講者後會重新計算。「次數」是輪到這位講者說話的次數，「平均」是平均一次說多久，「發言很少」是少於平均每人的四分之一。{extracted && '「決策」是這位講者提出或拍板的決策數（AI 從錄音抽出、你可以在「決策」修改）。'}
      </p>

      <DecisionsBySpeaker transcript={transcript} decisions={extracted} onOpenDecision={onOpenDecision} />

      <QuestionsAndInterruptions transcript={transcript} insights={insights} onSeek={onSeek} mediaAvailable={mediaAvailable} />
    </section>
  )
}

// 決策紀錄 from the speakers' side: how many decisions were made and who proposed each, each one opening in 決策.
// decisions is null until they've been extracted.
function DecisionsBySpeaker({
  transcript,
  decisions,
  onOpenDecision,
}: {
  transcript: Transcript
  decisions: JobDecisions['decisions'] | null
  onOpenDecision: (decisionId: string | null) => void
}) {
  const nameOf = speakerNameOrLabel(transcript.speakers)
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <h4 className="text-sm font-medium">決策</h4>
      {decisions === null ? (
        <>
          <p className="text-sm text-muted-foreground">還沒抽出這場的決策</p>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => onOpenDecision(null)}>
            到「決策」抽出
          </Button>
        </>
      ) : decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">這場沒有找到做成的決定</p>
      ) : (
        <>
          <p className="text-sm">{`這場有 ${decisions.length} 個決策`}</p>
          <ul aria-label="每位講者提出的決策" className="-mx-2 flex flex-col">
            {decisions.map((decision) => (
              <li key={decision.id}>
                <button
                  type="button"
                  onClick={() => onOpenDecision(decision.id)}
                  className="w-full rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="text-muted-foreground">
                    {decision.proposedBy ? nameOf(decision.proposedBy) : '不確定是誰'}：
                  </span>
                  {decision.statement}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

// The part judged by AI: there's no punctuation to count questions by, nor to tell whether someone finished speaking, so
// it's an estimate — every item comes with its time to listen and check.
function QuestionsAndInterruptions({
  transcript,
  insights: { insights, isRequesting, request },
  onSeek,
  mediaAvailable,
}: {
  transcript: Transcript
  insights: SpeakerInsightsActions
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}) {
  const nameOf = speakerNameOrLabel(transcript.speakers)
  const status = insights?.status ?? 'NONE'
  const hasResults = hasSpeakerInsightResults(insights)
  // Only once it's done: while analysing there's nothing to offer, and a failure already offers 再分析一次.
  const offerReanalysis = status === 'COMPLETED' && isSpeakerInsightsStale(insights, transcript)
  const { questions, interruptions } = insightsByKind(insights?.items ?? [])

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <h4 className="text-sm font-medium">問題與打斷</h4>
      <p className="text-xs text-muted-foreground">
        由 AI 讀逐字稿判斷誰提出了問題、誰在別人還沒講完時插話。這是 AI 估計，可能有誤；點時間聽原話確認。
      </p>

      {status === 'GENERATING' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-4 animate-spin" />
          分析中…
        </p>
      )}
      {status === 'FAILED' && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-destructive">{insights?.failureReason ?? '分析失敗'}</p>
          <Button size="sm" variant="outline" className="w-fit" disabled={isRequesting} onClick={request}>
            再分析一次
          </Button>
        </div>
      )}
      {status === 'NONE' && (
        <Button size="sm" variant="outline" className="w-fit" disabled={isRequesting} onClick={request}>
          分析問題與打斷
        </Button>
      )}
      {offerReanalysis && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <History className="mt-0.5 size-4 shrink-0" />
            逐字稿已修改，這份分析可能過時
          </p>
          <Button size="sm" variant="outline" className="w-fit bg-background" disabled={isRequesting} onClick={request}>
            <RefreshCw className="size-4" />
            重新分析
          </Button>
        </div>
      )}

      {hasResults && (
        <>
          <InsightList
            label="提出的問題"
            items={questions}
            empty="沒有找到提問"
            describe={(item) => nameOf(item.speakerLabel)}
            onSeek={onSeek}
            mediaAvailable={mediaAvailable}
          />
          <InsightList
            label="可能的打斷"
            items={interruptions}
            empty="沒有找到打斷"
            describe={(item) => `${nameOf(item.speakerLabel)} 打斷了 ${nameOf(item.interruptedLabel)}`}
            onSeek={onSeek}
            mediaAvailable={mediaAvailable}
          />
          {insights?.model && <p className="text-xs text-muted-foreground/80">由 {insights.model} 分析</p>}
        </>
      )}
    </div>
  )
}

function InsightList({
  label,
  items,
  empty,
  describe,
  onSeek,
  mediaAvailable,
}: {
  label: string
  items: SpeakerInsight[]
  empty: string
  describe: (item: SpeakerInsight) => string
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{`${label}（${items.length}）`}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul aria-label={label} className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={`${item.kind}-${item.startTime}`} className="flex items-start gap-2 text-sm">
              <TimestampButton seconds={item.startTime} onSeek={onSeek} mediaAvailable={mediaAvailable} />
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">{describe(item)}</span>
                <span className="leading-relaxed">{item.text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
