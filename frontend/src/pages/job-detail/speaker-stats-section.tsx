import { formatClock } from '@/lib/export-formats'
import { speakerColour } from '@/lib/speakers'
import type { MeetingStats } from '@/lib/speaker-stats'

// 講者數據 (.scratch/speaker-analytics): who talked how much, worked out straight from the transcript, so it follows
// speaker edits at once. Only shown with two or more speakers (the tile isn't there otherwise).
export function SpeakerStatsSection({ stats }: { stats: MeetingStats }) {
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
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        <li>{`換人 ${stats.speakerChanges} 次`}</li>
        {stats.silenceSeconds > 0 && <li>{`無人說話共 ${formatClock(stats.silenceSeconds)}`}</li>}
      </ul>
      <p className="text-xs text-muted-foreground/80">
        依逐字稿的時間計算；講者分得不對時，改片段的講者後會重新計算。「次數」是輪到這位講者說話的次數，「發言很少」是少於平均每人的四分之一。
      </p>
    </section>
  )
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

