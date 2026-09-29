import { useState } from 'react'
import { Pencil, Sparkles } from 'lucide-react'
import { hasMultipleSpeakers, speakersWithSegments } from '@/lib/speakers'
import { Button } from '@/components/ui/button'
import { SpeakerDot } from '@/pages/job-detail/speaker-dot'
import { NameInput } from '@/pages/job-detail/name-input'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import type { Speaker, SpeakerSuggestion, Transcript } from '@/types/api'

/** 講者名字建議 and what can be done with them (the page keeps them; see job-detail-page.tsx). */
export interface SpeakerSuggestionActions {
  suggestions: SpeakerSuggestion[]
  apply: (suggestion: SpeakerSuggestion) => Promise<void>
  dismiss: (speakerLabel: string) => void
  applyAll: (suggestions: SpeakerSuggestion[]) => Promise<void>
}

interface SpeakerPanelProps {
  transcript: Transcript
  /** Saves a new name for the speaker (an empty name restores 「講者 N」); rejects when saving fails. */
  onRename: (label: string, name: string) => Promise<void>
  suggestions: SpeakerSuggestionActions
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}

// A speaker the user hasn't named still shows 「講者 N」 (the backend's default name).
const hasDefaultName = (speaker: Speaker) => speaker.displayName === `講者 ${speaker.displayOrder}`

// The job's speakers (講者) above the transcript, each with its colour; clicking a name renames
// the speaker in place. Under them, the names the recording itself gives speakers the user hasn't named yet
// (講者名字建議), to apply or dismiss. Not shown for a single-speaker recording.
export function SpeakerPanel({ transcript, onRename, suggestions, onSeek, mediaAvailable }: SpeakerPanelProps) {
  const [renamingLabel, setRenamingLabel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!hasMultipleSpeakers(transcript.segments)) return null
  const speakers = speakersWithSegments(transcript.segments, transcript.speakers)
  const pending = suggestions.suggestions.flatMap((suggestion) => {
    const speaker = speakers.find((s) => s.label === suggestion.speakerLabel)
    return suggestion.status === 'pending' && speaker && hasDefaultName(speaker) && speaker.displayName !== suggestion.name
      ? [{ suggestion, speaker }]
      : []
  })
  const whileBusy = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p aria-hidden className="text-xs font-medium text-muted-foreground">
        講者
      </p>
      <ul aria-label="講者" className="flex flex-wrap gap-1.5 text-sm">
        {speakers.map((speaker) => (
          <li key={speaker.label} className="flex max-w-full min-w-0 items-center">
            {renamingLabel === speaker.label ? (
              <span className="flex max-w-full min-w-0 items-center gap-1.5 h-7 rounded-full border border-ring bg-background pr-0.5 pl-2.5 ring-[3px] ring-ring/30">
                <SpeakerDot speaker={speaker} />
                <NameInput
                  label="講者名稱"
                  initialName={speaker.displayName}
                  placeholder="留空＝預設名稱"
                  failureMessage="改名失敗"
                  onSave={(name) => onRename(speaker.label, name)}
                  onDone={() => setRenamingLabel(null)}
                  className="h-6 max-w-48 min-w-24 rounded-full border-0 px-1 focus-visible:ring-0"
                />
              </span>
            ) : (
              <button
                type="button"
                aria-label={`改名：${speaker.displayName}`}
                title="點一下改名"
                onClick={() => setRenamingLabel(speaker.label)}
                className="group/chip flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-background px-2.5 transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <SpeakerDot speaker={speaker} />
                <span className="min-w-0 truncate">{speaker.displayName}</span>
                <Pencil aria-hidden className="size-3 shrink-0 text-muted-foreground/60 transition-colors group-hover/chip:text-foreground" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {pending.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5">
          {pending.length > 1 && (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void whileBusy(() => suggestions.applyAll(pending.map((p) => p.suggestion)))}
              className="w-fit"
            >
              <Sparkles className="size-3" />
              全部套用（{pending.length}）
            </Button>
          )}
          {pending.map(({ suggestion, speaker }) => (
            <div
              key={suggestion.speakerLabel}
              role="group"
              aria-label={`${speaker.displayName} 可能是 ${suggestion.name}`}
              className="flex flex-col gap-1 rounded-lg border border-dashed bg-muted/40 px-2.5 py-2 text-xs"
            >
              <p className="flex items-center gap-1.5">
                <SpeakerDot speaker={speaker} />
                <span className="text-muted-foreground">{speaker.displayName} 可能是</span>
                <span className="font-medium">{suggestion.name}</span>
              </p>
              {/* The line it comes from, to hear before deciding. */}
              <p className="flex items-start gap-1.5 text-muted-foreground">
                <TimestampButton seconds={suggestion.evidenceStartTime} onSeek={onSeek} mediaAvailable={mediaAvailable} />
                <span className="min-w-0 break-words">「{suggestion.evidenceText}」</span>
              </p>
              <div className="flex gap-1.5">
                <Button size="xs" disabled={busy} onClick={() => void whileBusy(() => suggestions.apply(suggestion))}>
                  套用
                </Button>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => suggestions.dismiss(suggestion.speakerLabel)}>
                  忽略
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
