import { useState } from 'react'
import { toast } from 'sonner'
import { handleEditorKeys } from '@/lib/editor-keys'
import { cn } from '@/lib/utils'

// Same limit as the backend (speakers.name).
const MAX_SPEAKER_NAME_LENGTH = 100

interface SpeakerNameInputProps {
  label: string
  initialName: string
  placeholder?: string
  /** What to toast when saving fails; the input stays open with what the user typed. */
  failureMessage: string
  /** Saves the trimmed name; not called when it's unchanged from `initialName` (unless `saveUnchanged`). */
  onSave: (name: string) => Promise<void>
  onDone: () => void
  saveUnchanged?: boolean
  className?: string
}

// The in-place box for a 講者's name — renaming a speaker, or naming one being added. Enter saves,
// Esc cancels.
export function SpeakerNameInput({
  label,
  initialName,
  placeholder,
  failureMessage,
  onSave,
  onDone,
  saveUnchanged = false,
  className,
}: SpeakerNameInputProps) {
  const [draft, setDraft] = useState(initialName)
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    const name = draft.trim()
    if (name === initialName && !saveUnchanged) {
      onDone() // nothing changed: no request
      return
    }
    setIsSaving(true)
    try {
      await onSave(name)
      onDone()
    } catch {
      toast.error(failureMessage)
      setIsSaving(false)
    }
  }

  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      // Esc here cancels; the Source Sheet must not treat it as "close" (see completed-workspace.tsx).
      data-consumes-escape=""
      autoFocus
      onFocus={(event) => event.target.select()}
      maxLength={MAX_SPEAKER_NAME_LENGTH}
      value={draft}
      disabled={isSaving}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => handleEditorKeys(event, { save: () => void save(), cancel: onDone })}
      className={cn(
        'field-sizing-content rounded-md border bg-background px-1.5 py-0.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
        className,
      )}
    />
  )
}
