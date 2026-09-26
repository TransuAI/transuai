import type { Speaker, TranscriptSegment } from '@/types/api'

// 講者 (see transcription-service CONTEXT.md). The display name is decided by the backend
// (the user's name, or 「講者 N」); the frontend only looks it up by label.

/** Looks up a segment's speaker name by its label; null when the segment has no speaker. */
export function speakerNameLookup(speakers: Speaker[]): (label: string | null) => string | null {
  const names = new Map(speakers.map((speaker) => [speaker.label, speaker.displayName]))
  return (label) => (label === null ? null : (names.get(label) ?? null))
}

/**
 * The name to show on each segment: only on the first segment of a speaker's turn, like a chat
 * log; null everywhere else. A cleared segment (已清空片段) shows no name and doesn't end a turn.
 */
export function speakerNamesAtTurns(segments: TranscriptSegment[], speakers: Speaker[]): (string | null)[] {
  const speakerName = speakerNameLookup(speakers)
  let previousLabel: string | null = null
  return segments.map((segment) => {
    if (segment.text === '') return null
    const startsTurn = segment.speakerLabel !== null && segment.speakerLabel !== previousLabel
    previousLabel = segment.speakerLabel
    return startsTurn ? speakerName(segment.speakerLabel) : null
  })
}
