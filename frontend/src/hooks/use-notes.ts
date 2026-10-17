import { useCallback, useEffect, useState } from 'react'
import { notesApi } from '@/lib/api'
import { sortNotes } from '@/lib/notes'
import type { Note, NoteSource } from '@/types/api'

export interface NotesActions {
  notes: Note[]
  /** Saves a new note and returns it; rejects when saving fails. */
  add: (note: { timeSeconds?: number; text?: string; source?: NoteSource }) => Promise<Note>
  update: (noteId: string, text: string) => Promise<void>
  remove: (noteId: string) => Promise<void>
}

// 筆記 (see upload-service CONTEXT.md), loaded once the job is done. Kept at the page level like 測驗, so the phone's
// Studio Sheet closing doesn't lose them. Failures reject, for the caller to say so and keep what the user typed.
export function useNotes(jobId: string | undefined, enabled: boolean): NotesActions {
  const [notes, setNotes] = useState<Note[]>([])

  useEffect(() => {
    if (!jobId || !enabled) return
    notesApi.list(jobId).then(setNotes).catch(() => setNotes([]))
  }, [jobId, enabled])

  const add = useCallback(
    async (note: { timeSeconds?: number; text?: string; source?: NoteSource }) => {
      if (!jobId) throw new Error('no job')
      const created = await notesApi.create(jobId, note)
      setNotes((prev) => sortNotes([...prev, created]))
      return created
    },
    [jobId],
  )
  const update = useCallback(
    async (noteId: string, text: string) => {
      if (!jobId) return
      const updated = await notesApi.update(jobId, noteId, text)
      setNotes((prev) => prev.map((note) => (note.noteId === noteId ? updated : note)))
    },
    [jobId],
  )
  const remove = useCallback(
    async (noteId: string) => {
      if (!jobId) return
      await notesApi.remove(jobId, noteId)
      setNotes((prev) => prev.filter((note) => note.noteId !== noteId))
    },
    [jobId],
  )
  return { notes, add, update, remove }
}
