import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { formatDuration } from '@/lib/media'
import type { TranscriptMatch } from '@/lib/transcript-search'
import { cn } from '@/lib/utils'
import type { TranscriptSegment } from '@/types/api'

function HighlightedText({ text, matches, activeStart }: { text: string; matches: TranscriptMatch[]; activeStart: number | null }) {
  const parts = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) parts.push(text.slice(cursor, match.start))
    parts.push(
      <mark
        key={match.start}
        className={cn(
          'rounded-sm bg-search-match text-inherit',
          match.start === activeStart && 'bg-primary text-primary-foreground',
        )}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    )
    cursor = match.end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

interface SegmentRowProps {
  segment: TranscriptSegment
  index: number
  isCurrent: boolean
  matches: TranscriptMatch[]
  activeMatchStart: number | null
  mediaAvailable: boolean
  onSeek: (seconds: number) => void
  isEditing: boolean
  onStartEdit: () => void
  onEndEdit: () => void
  onSave: (text: string) => Promise<void>
}

// One 片段 of the transcript: its timestamp (click to seek), its text (search matches
// highlighted) and, while it's being edited (編輯), an in-place editor.
export function SegmentRow({
  segment,
  index,
  isCurrent,
  matches,
  activeMatchStart,
  mediaAvailable,
  onSeek,
  isEditing,
  onStartEdit,
  onEndEdit,
  onSave,
}: SegmentRowProps) {
  // When the editor closes, give keyboard focus back to this segment's edit button rather than
  // letting it fall to <body>.
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const wasEditingRef = useRef(isEditing)
  useEffect(() => {
    if (wasEditingRef.current && !isEditing) editButtonRef.current?.focus()
    wasEditingRef.current = isEditing
  }, [isEditing])

  return (
    <div
      data-segment-index={index}
      aria-current={isCurrent ? 'true' : undefined}
      className={cn(
        'group -mx-2 flex gap-3 rounded-md px-2 py-1 text-sm transition-colors',
        isCurrent && 'bg-primary/10',
      )}
    >
      <button
        type="button"
        disabled={!mediaAvailable}
        onClick={() => onSeek(segment.startTime)}
        className="h-fit shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
      >
        {formatDuration(segment.startTime)}
      </button>
      {isEditing ? (
        <SegmentEditor initialText={segment.text} onSave={onSave} onDone={onEndEdit} />
      ) : (
        <>
          <p className="min-w-0 flex-1 leading-relaxed">
            {segment.speakerLabel && <span className="mr-1 font-medium">{segment.speakerLabel}:</span>}
            <HighlightedText text={segment.text} matches={matches} activeStart={activeMatchStart} />
          </p>
          <button
            ref={editButtonRef}
            type="button"
            aria-label="編輯片段"
            onClick={onStartEdit}
            // Shown on hover or when keyboard focus is anywhere in the segment; always shown on touch
            // screens, which have no hover.
            className="h-fit shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Pencil className="size-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

function SegmentEditor({
  initialText,
  onSave,
  onDone,
}: {
  initialText: string
  onSave: (text: string) => Promise<void>
  onDone: () => void
}) {
  const [draft, setDraft] = useState(initialText)
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    if (draft.trim() === initialText) {
      onDone() // nothing changed: no request, no 儲存中… flash
      return
    }
    setIsSaving(true)
    try {
      await onSave(draft)
      onDone()
    } catch {
      // Keep the editor open with what the user typed, so a network hiccup doesn't lose it.
      toast.error('儲存失敗')
      setIsSaving(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // While an IME is composing, Enter confirms the characters being typed and Esc drops the
    // composition — neither is meant for the editor. (Safari reports the confirming Enter after
    // compositionend, with keyCode 229.)
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') {
      // A segment is a single line; Enter saves instead of inserting a newline.
      event.preventDefault()
      void save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onDone()
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <textarea
        aria-label="編輯片段文字"
        // Esc here cancels the edit; the Source Sheet must not treat it as "close" (see
        // completed-workspace.tsx).
        data-consumes-escape=""
        autoFocus
        rows={1}
        value={draft}
        disabled={isSaving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        className="field-sizing-content w-full resize-none rounded-md border bg-background px-2 py-1 leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
      />
      <p className="text-xs text-muted-foreground">{isSaving ? '儲存中…' : 'Enter 儲存・Esc 取消'}</p>
    </div>
  )
}
