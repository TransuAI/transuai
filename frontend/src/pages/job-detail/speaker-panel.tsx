import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { hasMultipleSpeakers, speakersWithSegments } from '@/lib/speakers'
import { SpeakerDot } from '@/pages/job-detail/speaker-dot'
import { SpeakerNameInput } from '@/pages/job-detail/speaker-name-input'
import type { Transcript } from '@/types/api'

interface SpeakerPanelProps {
  transcript: Transcript
  /** Saves a new name for the speaker (an empty name restores 「講者 N」); rejects when saving fails. */
  onRename: (label: string, name: string) => Promise<void>
}

// The job's speakers (講者) above the transcript, each with its colour; clicking a name renames
// the speaker in place. Not shown for a single-speaker recording.
export function SpeakerPanel({ transcript, onRename }: SpeakerPanelProps) {
  const [renamingLabel, setRenamingLabel] = useState<string | null>(null)
  if (!hasMultipleSpeakers(transcript.segments)) return null
  return (
    <div className="flex flex-col gap-1.5">
      <p aria-hidden className="text-xs font-medium text-muted-foreground">
        講者
      </p>
      <ul aria-label="講者" className="flex flex-wrap gap-1.5 text-sm">
        {speakersWithSegments(transcript.segments, transcript.speakers).map((speaker) => (
          <li key={speaker.label} className="flex max-w-full min-w-0 items-center">
            {renamingLabel === speaker.label ? (
              <span className="flex max-w-full min-w-0 items-center gap-1.5 h-7 rounded-full border border-ring bg-background pr-0.5 pl-2.5 ring-[3px] ring-ring/30">
                <SpeakerDot speaker={speaker} />
                <SpeakerNameInput
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
    </div>
  )
}
