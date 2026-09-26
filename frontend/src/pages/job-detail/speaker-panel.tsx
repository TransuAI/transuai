import { useState } from 'react'
import { toast } from 'sonner'
import { handleEditorKeys } from '@/lib/editor-keys'
import { hasMultipleSpeakers, speakersWithSegments } from '@/lib/speakers'
import { SpeakerDot } from '@/pages/job-detail/speaker-dot'
import type { Speaker, Transcript } from '@/types/api'

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
            <SpeakerNameEditor
              speaker={speaker}
              onSave={(name) => onRename(speaker.label, name)}
              onDone={() => setRenamingLabel(null)}
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

function SpeakerNameEditor({
  speaker,
  onSave,
  onDone,
}: {
  speaker: Speaker
  onSave: (name: string) => Promise<void>
  onDone: () => void
}) {
  const [draft, setDraft] = useState(speaker.displayName)
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    if (draft.trim() === speaker.displayName) {
      onDone() // nothing changed: no request
      return
    }
    setIsSaving(true)
    try {
      await onSave(draft.trim())
      onDone()
    } catch {
      // Keep the editor open with what the user typed.
      toast.error('改名失敗')
      setIsSaving(false)
    }
  }

  return (
    <input
      aria-label="講者名稱"
      // Esc here cancels the rename; the Source Sheet must not treat it as "close" (see
      // completed-workspace.tsx).
      data-consumes-escape=""
      autoFocus
      onFocus={(event) => event.target.select()}
      maxLength={100}
      placeholder={`講者 ${speaker.displayOrder}`}
      value={draft}
      disabled={isSaving}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => handleEditorKeys(event, { save: () => void save(), cancel: onDone })}
      className="field-sizing-content min-w-16 rounded-md border bg-background px-1.5 py-0.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
    />
  )
}
