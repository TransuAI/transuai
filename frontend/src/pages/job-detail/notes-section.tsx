import { useState } from 'react'
import { BookmarkPlus, MessageCircle, NotebookPen, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { NotesActions } from '@/hooks/use-notes'
import { Button } from '@/components/ui/button'
import { TimestampButton } from '@/pages/job-detail/timestamp-button'
import type { Note } from '@/types/api'

const NOT_SAVED = '筆記沒有存到'

interface NotesSectionProps {
  notes: NotesActions
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
  /** Where playback is now, for 「在目前時間加筆記」; null without a player. */
  currentTime: () => number | null
}

// 筆記 (see upload-service CONTEXT.md) in the Studio: by time, unpinned ones last. A note pinned to a time plays from
// there; one with a time and no text is a bookmark (書籤).
export function NotesSection({ notes, onSeek, mediaAvailable, currentTime }: NotesSectionProps) {
  const [drafting, setDrafting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  // A bookmark first (it's saved even if the user types nothing), then open it for writing.
  const addAtCurrentTime = async () => {
    const seconds = currentTime()
    if (seconds === null) return
    try {
      const note = await notes.add({ timeSeconds: Math.round(seconds * 10) / 10 })
      setEditingId(note.noteId)
    } catch {
      toast.error(NOT_SAVED)
    }
  }

  return (
    <section aria-labelledby="notes-heading" className="flex flex-col gap-3">
      <h3 id="notes-heading" className="flex items-center gap-2 text-sm font-medium">
        <NotebookPen className="size-4" />
        筆記
      </h3>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!mediaAvailable} onClick={() => void addAtCurrentTime()}>
          <BookmarkPlus className="size-4" />
          在目前時間加筆記
        </Button>
        <Button size="sm" variant="ghost" disabled={drafting} onClick={() => setDrafting(true)}>
          <Plus className="size-4" />
          新增筆記
        </Button>
      </div>
      {drafting && (
        <NoteEditor
          label="新筆記"
          initialText=""
          allowEmpty={false}
          onSave={async (text) => {
            await notes.add({ text })
            setDrafting(false)
          }}
          onCancel={() => setDrafting(false)}
        />
      )}
      {notes.notes.length > 0 ? (
        <ol aria-label="筆記" className="flex flex-col divide-y">
          {notes.notes.map((note) => (
            <li key={note.noteId} className="flex flex-col gap-1.5 py-2.5 first:pt-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {note.timeSeconds !== null ? (
                  <TimestampButton seconds={note.timeSeconds} onSeek={onSeek} mediaAvailable={mediaAvailable} />
                ) : (
                  <span>未釘時間</span>
                )}
                {note.source === 'qa' && (
                  <span title="從問答存的" className="flex items-center">
                    <MessageCircle aria-hidden className="size-3.5" />
                    <span className="sr-only">從問答存的</span>
                  </span>
                )}
                {editingId !== note.noteId && confirmingDeleteId !== note.noteId && (
                  <span className="ml-auto flex gap-0.5">
                    <Button size="icon-xs" variant="ghost" aria-label="編輯筆記" onClick={() => setEditingId(note.noteId)}>
                      <Pencil />
                    </Button>
                    <Button size="icon-xs" variant="ghost" aria-label="刪除筆記" onClick={() => setConfirmingDeleteId(note.noteId)}>
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </div>
              {editingId === note.noteId ? (
                <NoteEditor
                  label="編輯筆記"
                  initialText={note.text}
                  allowEmpty={note.timeSeconds !== null}
                  onSave={async (text) => {
                    if (text !== note.text) await notes.update(note.noteId, text)
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <NoteText note={note} />
              )}
              {confirmingDeleteId === note.noteId && (
                <DeleteConfirmation
                  onDelete={async () => {
                    try {
                      await notes.remove(note.noteId)
                    } catch {
                      toast.error('筆記沒有刪掉')
                    }
                    setConfirmingDeleteId(null)
                  }}
                  onCancel={() => setConfirmingDeleteId(null)}
                />
              )}
            </li>
          ))}
        </ol>
      ) : (
        !drafting && <p className="text-sm text-muted-foreground">還沒有筆記。聽到重要的地方，按「在目前時間加筆記」。</p>
      )}
    </section>
  )
}

function NoteText({ note }: { note: Note }) {
  if (!note.text) return <p className="text-sm text-muted-foreground/80 italic">書籤</p>
  return <p className="text-sm leading-relaxed whitespace-pre-wrap">{note.text}</p>
}

function DeleteConfirmation({ onDelete, onCancel }: { onDelete: () => Promise<void>; onCancel: () => void }) {
  const [deleting, setDeleting] = useState(false)
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">刪除這則筆記？</span>
      <Button
        size="xs"
        variant="destructive"
        disabled={deleting}
        onClick={() => {
          setDeleting(true)
          void onDelete()
        }}
      >
        刪除
      </Button>
      <Button size="xs" variant="ghost" disabled={deleting} onClick={onCancel}>
        取消
      </Button>
    </div>
  )
}

// A note's text: Enter makes a new line (notes are written, not one-liners); Ctrl/⌘+Enter or 儲存 saves, Esc cancels.
function NoteEditor({
  label,
  initialText,
  allowEmpty,
  onSave,
  onCancel,
}: {
  label: string
  initialText: string
  /** A note pinned to a time may be left without text (a bookmark); an unpinned one may not. */
  allowEmpty: boolean
  /** Rejects when saving fails; the editor then keeps what was typed. */
  onSave: (text: string) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialText)
  const [saving, setSaving] = useState(false)
  const canSave = !saving && (allowEmpty || draft.trim() !== '')
  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await onSave(draft.trim())
    } catch {
      toast.error(NOT_SAVED)
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        aria-label={label}
        // Esc here cancels; the Studio Sheet must not treat it as "close" (see completed-workspace.tsx).
        data-consumes-escape=""
        autoFocus
        rows={3}
        maxLength={2000}
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void save()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
      />
      <div className="flex items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground pointer-coarse:hidden">Ctrl+Enter 儲存・Esc 取消</span>
        <Button size="xs" variant="ghost" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button size="xs" disabled={!canSave} onClick={() => void save()}>
          儲存
        </Button>
      </div>
    </div>
  )
}
