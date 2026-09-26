import { useState } from 'react'
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
    <ul aria-label="講者" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {speakersWithSegments(transcript.segments, transcript.speakers).map((speaker) => (
        <li key={speaker.label} className="flex items-center gap-1.5">
          <SpeakerDot speaker={speaker} />
          {renamingLabel === speaker.label ? (
            <SpeakerNameInput
              label="講者名稱"
              initialName={speaker.displayName}
              placeholder="留空＝預設名稱"
              failureMessage="改名失敗"
              onSave={(name) => onRename(speaker.label, name)}
              onDone={() => setRenamingLabel(null)}
              className="min-w-16"
            />
          ) : (
            <button
              type="button"
              aria-label={`改名：${speaker.displayName}`}
              title="點一下改名"
              onClick={() => setRenamingLabel(speaker.label)}
              className="rounded-sm underline-offset-2 hover:underline"
            >
              {speaker.displayName}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
