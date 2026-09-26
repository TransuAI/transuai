import { useEffect, useRef, useState } from 'react'
import { Pencil, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { handleEditorKeys } from '@/lib/editor-keys'
import { formatDuration } from '@/lib/media'
import type { TranscriptMatch } from '@/lib/transcript-search'
import { cn } from '@/lib/utils'
import { SpeakerDot } from '@/pages/job-detail/speaker-dot'
import type { Speaker, TranscriptSegment } from '@/types/api'

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
  /** Shown before the text on the first segment of a speaker's turn; null elsewhere. */
  turnSpeaker: Speaker | null
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
// highlighted) and, while it's being edited (編輯), an in-place editor. An 已編輯片段 (text differs
// from the original text) carries a small marker and can be restored; an 已清空片段 (empty text)
// is a faint 「已清空 · 還原」 row that keeps its time range (it can still be the current segment).
export function SegmentRow({
  segment,
  turnSpeaker,
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
  // Same after a restore: the 還原 button that had focus is gone once the text changes.
  const focusEditButtonRef = useRef(false)
  useEffect(() => {
    if (focusEditButtonRef.current) {
      editButtonRef.current?.focus()
      focusEditButtonRef.current = false
    }
  })

  const isCleared = segment.text === ''
  const isEdited = !isCleared && segment.text !== segment.originalText
  // A cleared segment the transcriber had already left empty has nothing to go back to. (An edited
  // one always does — even if restoring it means clearing it again.)
  const canRestoreCleared = isCleared && segment.originalText !== ''
  const [isRestoring, setIsRestoring] = useState(false)
  // Restoring is an edit like any other: the original text goes back through the same save.
  const restore = async () => {
    setIsRestoring(true)
    try {
      await onSave(segment.originalText)
      focusEditButtonRef.current = true
    } catch {
      toast.error('還原失敗')
    } finally {
      setIsRestoring(false)
    }
  }
  const hoverAction =
    'h-fit shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 pointer-coarse:opacity-100'

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
      ) : isCleared ? (
        <p className="min-w-0 flex-1 leading-relaxed text-muted-foreground/70">
          <span>已清空</span>
          {canRestoreCleared && (
            <>
              {' · '}
              <button
                type="button"
                // Named after what comes back, so a list of cleared rows can be told apart.
                aria-label={`還原：${segment.originalText}`}
                disabled={isRestoring}
                onClick={() => void restore()}
                className="underline-offset-2 hover:underline disabled:opacity-60"
              >
                還原
              </button>
            </>
          )}
        </p>
      ) : (
        <>
          <p className="min-w-0 flex-1 leading-relaxed">
            {turnSpeaker && (
              <span className="font-medium">
                <SpeakerDot speaker={turnSpeaker} className="mr-1.5 align-middle" />
                {turnSpeaker.displayName}：
              </span>
            )}
            <HighlightedText text={segment.text} matches={matches} activeStart={activeMatchStart} />
            {isEdited && (
              <span className="ml-1.5 rounded bg-muted px-1 align-middle text-xs text-muted-foreground">
                {/* Read as 「…（已編輯）」 rather than run into the text. */}
                <span className="sr-only">（</span>已編輯<span className="sr-only">）</span>
              </span>
            )}
          </p>
          {isEdited && (
            <button
              type="button"
              aria-label="還原成原始文字"
              title={segment.originalText}
              disabled={isRestoring}
              onClick={() => void restore()}
              className={cn(hoverAction, 'disabled:opacity-60')}
            >
              <Undo2 className="size-3.5" />
            </button>
          )}
          <button
            ref={editButtonRef}
            type="button"
            aria-label="編輯片段"
            onClick={onStartEdit}
            // Shown on hover or when keyboard focus is anywhere in the segment; always shown on touch
            // screens, which have no hover.
            className={hoverAction}
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
        // A segment is a single line; Enter saves instead of inserting a newline.
        onKeyDown={(event) => handleEditorKeys(event, { save: () => void save(), cancel: onDone })}
        className="field-sizing-content w-full resize-none rounded-md border bg-background px-2 py-1 leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
      />
      <p className="text-xs text-muted-foreground">{isSaving ? '儲存中…' : 'Enter 儲存・Esc 取消'}</p>
    </div>
  )
}
