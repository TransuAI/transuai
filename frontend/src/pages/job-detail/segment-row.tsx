import { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Pencil, StickyNote, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { handleEditorKeys } from '@/lib/editor-keys'
import { formatDuration } from '@/lib/media'
import type { TranscriptMatch } from '@/lib/transcript-search'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SegmentSpeakerMenu } from '@/pages/job-detail/segment-speaker-menu'
import { SpeakerNameInput } from '@/pages/job-detail/speaker-name-input'
import { SpeakerDot } from '@/pages/job-detail/speaker-dot'
import type { Note, Speaker, SpeakerAssignment, TranscriptSegment } from '@/types/api'

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

const ASSIGN_SPEAKER_FAILED = '改講者失敗'

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
  /** Who the segment can be handed to (改講者). */
  speakerChoices: Speaker[]
  onAssignSpeaker: (assignment: SpeakerAssignment) => Promise<void>
  /** The 筆記 pinned within this segment's time, marked by its timestamp. */
  notes: Note[]
  /** 在這裡加筆記: a note at the segment's start. */
  onAddNote: () => void
  onOpenNote: (noteId: string) => void
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
  speakerChoices,
  onAssignSpeaker,
  notes,
  onAddNote,
  onOpenNote,
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
  const [speakerMenuOpen, setSpeakerMenuOpen] = useState(false)
  const [isAddingSpeaker, setIsAddingSpeaker] = useState(false)
  const giveToSpeaker = async (label: string) => {
    try {
      await onAssignSpeaker({ speakerLabel: label })
    } catch {
      toast.error(ASSIGN_SPEAKER_FAILED)
    }
  }
  // The segment's actions float over its top-right corner instead of taking a column of their own,
  // so the text keeps the pane's full width; shown on hover or when keyboard focus is anywhere in
  // the segment. Touch screens have no hover: there they're always shown, in a third column so
  // they don't cover the text.
  const toolbarHidden = 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100'
  const toolbarButton =
    'rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-60'

  return (
    <div
      data-segment-index={index}
      aria-current={isCurrent ? 'true' : undefined}
      // Two columns: the timestamp, and the text with the speaker's name above it at the start of a
      // turn. The name comes before the text in the markup so it reads as 「講者：…」.
      className={cn(
        'group relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 pointer-coarse:grid-cols-[auto_minmax(0,1fr)_auto] rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50',
        (turnSpeaker || isAddingSpeaker) && 'mt-2 first:mt-0',
        isCurrent && 'bg-primary/10 hover:bg-primary/10',
      )}
    >
      <div className="row-start-2 flex flex-col items-center gap-1">
        <button
          type="button"
          disabled={!mediaAvailable}
          onClick={() => onSeek(segment.startTime)}
          className="mt-px h-fit rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground tabular-nums enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
        >
          {formatDuration(segment.startTime)}
        </button>
        {notes.length > 0 && (
          // One mark per note, its text on hover; clicking opens it in the Studio.
          <div className="flex flex-wrap justify-center gap-0.5">
            {notes.map((note) => (
              <button
                key={note.noteId}
                type="button"
                aria-label={`筆記：${note.text || '書籤'}`}
                title={note.text || '書籤'}
                onClick={() => onOpenNote(note.noteId)}
                className="rounded p-0.5 text-primary hover:bg-accent"
              >
                <StickyNote className="size-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>
      {isAddingSpeaker ? (
        <div className="col-start-2 row-start-1 mb-1">
          <SpeakerNameInput
            label="新講者名稱"
            initialName=""
            placeholder="新講者名稱（可留空）"
            failureMessage={ASSIGN_SPEAKER_FAILED}
            saveUnchanged
            onSave={(name) => onAssignSpeaker({ newSpeaker: { name } })}
            onDone={() => setIsAddingSpeaker(false)}
            className="min-w-40 max-w-full text-sm"
          />
        </div>
      ) : (
        turnSpeaker && (
          <button
            type="button"
            aria-label={`改講者：${turnSpeaker.displayName}`}
            onClick={() => setSpeakerMenuOpen(true)}
            className="col-start-2 row-start-1 mb-0.5 flex w-fit max-w-full items-center gap-1.5 rounded-sm text-left text-[13px] font-semibold underline-offset-2 hover:underline"
          >
            <SpeakerDot speaker={turnSpeaker} />
            <span className="min-w-0 truncate">{turnSpeaker.displayName}</span>
            <span className="sr-only">：</span>
          </button>
        )
      )}
      {isEditing ? (
        <SegmentEditor initialText={segment.text} onSave={onSave} onDone={onEndEdit} />
      ) : isCleared ? (
        <p className="col-start-2 row-start-2 leading-relaxed text-muted-foreground/70">
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
          <p className="col-start-2 row-start-2 leading-relaxed break-words">
            <HighlightedText text={segment.text} matches={matches} activeStart={activeMatchStart} />
            {isEdited && (
              // inline-block: an inline box holding the sr-only parentheses can break into a stray
              // empty fragment on the next line.
              <span className="ml-1.5 inline-block rounded bg-muted px-1 align-middle text-xs leading-5 whitespace-nowrap text-muted-foreground">
                {/* Read as 「…（已編輯）」 rather than run into the text. */}
                <span className="sr-only">（</span>已編輯<span className="sr-only">）</span>
              </span>
            )}
          </p>
          <div
            className={cn(
              'absolute top-1 right-1 flex items-center gap-0.5 rounded-md bg-popover p-0.5 shadow-sm ring-1 ring-foreground/10 transition-opacity',
              'pointer-coarse:static pointer-coarse:col-start-3 pointer-coarse:row-start-2 pointer-coarse:h-fit pointer-coarse:bg-transparent pointer-coarse:p-0 pointer-coarse:shadow-none pointer-coarse:ring-0',
              !speakerMenuOpen && toolbarHidden,
            )}
          >
            {isEdited && (
              <button
                type="button"
                aria-label="還原成原始文字"
                title={segment.originalText}
                disabled={isRestoring}
                onClick={() => void restore()}
                className={toolbarButton}
              >
                <Undo2 className="size-3.5" />
              </button>
            )}
            <SegmentSpeakerMenu
              open={speakerMenuOpen}
              onOpenChange={setSpeakerMenuOpen}
              currentLabel={segment.speakerLabel}
              choices={speakerChoices}
              onChoose={(label) => void giveToSpeaker(label)}
              onAddSpeaker={() => setIsAddingSpeaker(true)}
              triggerClassName={toolbarButton}
            />
            <button type="button" aria-label="在這裡加筆記" title="在這裡加筆記" onClick={onAddNote} className={toolbarButton}>
              <BookmarkPlus className="size-3.5" />
            </button>
            <button ref={editButtonRef} type="button" aria-label="編輯片段" onClick={onStartEdit} className={toolbarButton}>
              <Pencil className="size-3.5" />
            </button>
          </div>
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
    <div className="col-start-2 row-start-2 flex min-w-0 flex-col gap-1.5">
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
        // The negative margin lines the text up with where it sat before the editor opened.
        className="field-sizing-content -mx-2 -my-1 w-[calc(100%+1rem)] resize-none rounded-md border bg-background px-[calc(0.5rem-1px)] py-[calc(0.25rem-1px)] leading-relaxed shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
      />
      <div className="mt-1 flex items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">
          {isSaving ? '儲存中…' : <span className="pointer-coarse:hidden">Enter 儲存・Esc 取消</span>}
        </p>
        {/* For touch screens, whose keyboards have no Esc; also handy with a mouse. */}
        <Button size="xs" variant="ghost" disabled={isSaving} onClick={onDone}>
          取消
        </Button>
        <Button size="xs" disabled={isSaving} onClick={() => void save()}>
          儲存
        </Button>
      </div>
    </div>
  )
}
