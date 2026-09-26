import { useRef, useState } from 'react'
import { UserRoundPen } from 'lucide-react'
import { toast } from 'sonner'
import { handleEditorKeys } from '@/lib/editor-keys'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SpeakerDot } from '@/pages/job-detail/speaker-dot'
import type { Speaker } from '@/types/api'

interface SegmentSpeakerMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The segment's current speaker, marked in the menu. */
  currentLabel: string | null
  choices: Speaker[]
  onChoose: (label: string) => void
  onAddSpeaker: () => void
  triggerClassName: string
}

// 改講者: the segment's action for fixing a speaker separation mistake — hand the segment to
// another speaker, or add a new one. Also opened by clicking the speaker's name on the segment.
export function SegmentSpeakerMenu({
  open,
  onOpenChange,
  currentLabel,
  choices,
  onChoose,
  onAddSpeaker,
  triggerClassName,
}: SegmentSpeakerMenuProps) {
  const addingSpeakerRef = useRef(false)
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="改講者" className={triggerClassName}>
          <UserRoundPen className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Adding a speaker opens a name box that should get the focus. It only appears once the menu
        // has closed — while the menu is open its focus trap would pull the focus straight back.
        onCloseAutoFocus={(event) => {
          if (!addingSpeakerRef.current) return
          addingSpeakerRef.current = false
          event.preventDefault()
          onAddSpeaker()
        }}
      >
        {choices.length > 0 && (
          <>
            <DropdownMenuRadioGroup
              value={currentLabel ?? ''}
              onValueChange={(label) => label !== currentLabel && onChoose(label)}
            >
              {choices.map((speaker) => (
                <DropdownMenuRadioItem key={speaker.label} value={speaker.label} className="gap-2">
                  <SpeakerDot speaker={speaker} />
                  {speaker.displayName}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onSelect={() => {
            addingSpeakerRef.current = true
          }}
        >
          新增講者…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Names the speaker being added for a segment (optional: an empty name means 「講者 N」). */
export function NewSpeakerEditor({ onSave, onDone }: { onSave: (name: string) => Promise<void>; onDone: () => void }) {
  const [draft, setDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    setIsSaving(true)
    try {
      await onSave(draft.trim())
      onDone()
    } catch {
      toast.error('改講者失敗')
      setIsSaving(false)
    }
  }

  return (
    <input
      aria-label="新講者名稱"
      placeholder="新講者名稱（可留空）"
      // Esc here cancels; the Source Sheet must not treat it as "close" (see completed-workspace.tsx).
      data-consumes-escape=""
      autoFocus
      maxLength={100}
      value={draft}
      disabled={isSaving}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => handleEditorKeys(event, { save: () => void save(), cancel: onDone })}
      className="mr-1.5 field-sizing-content min-w-40 rounded-md border bg-background px-1.5 py-0.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
    />
  )
}
