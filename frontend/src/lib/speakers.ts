import type { Speaker, TranscriptSegment } from '@/types/api'

// 講者 (see transcription-service CONTEXT.md). The display name is decided by the backend
// (the user's name, or 「講者 N」); the frontend only looks it up by label.

/** Looks up a segment's speaker name by its label; null when the segment has no speaker. */
export function speakerNameLookup(speakers: Speaker[]): (label: string | null) => string | null {
  const names = new Map(speakers.map((speaker) => [speaker.label, speaker.displayName]))
  return (label) => (label === null ? null : (names.get(label) ?? null))
}

/**
 * Whether speakers are shown at all: only when the segments that aren't cleared (已清空片段) come
 * from two or more speakers. A single-speaker recording shows no speaker panel or names.
 */
export function hasMultipleSpeakers(segments: TranscriptSegment[]): boolean {
  const labels = new Set(segments.filter((segment) => segment.text !== '').map((segment) => segment.speakerLabel))
  labels.delete(null)
  return labels.size >= 2
}

/** The speakers to list: those with at least one segment that isn't cleared, in display order. */
export function speakersWithSegments(segments: TranscriptSegment[], speakers: Speaker[]): Speaker[] {
  const labels = new Set(segments.filter((segment) => segment.text !== '').map((segment) => segment.speakerLabel))
  return speakers.filter((speaker) => labels.has(speaker.label))
}

/** The speaker of a segment, when speakers are shown at all (see hasMultipleSpeakers). */
export function shownSpeakerOf(segment: TranscriptSegment, segments: TranscriptSegment[], speakers: Speaker[]): Speaker | null {
  if (!hasMultipleSpeakers(segments)) return null
  return speakers.find((speaker) => speaker.label === segment.speakerLabel) ?? null
}

/**
 * The speaker to show on each segment: only on the first segment of a speaker's turn, like a chat
 * log; null everywhere else, and everywhere when speakers aren't shown. A cleared segment shows
 * no speaker and doesn't end a turn.
 */
export function speakersAtTurns(segments: TranscriptSegment[], speakers: Speaker[]): (Speaker | null)[] {
  if (!hasMultipleSpeakers(segments)) return segments.map(() => null)
  const byLabel = new Map(speakers.map((speaker) => [speaker.label, speaker]))
  let previousLabel: string | null = null
  return segments.map((segment) => {
    if (segment.text === '') return null
    const startsTurn = segment.speakerLabel !== null && segment.speakerLabel !== previousLabel
    previousLabel = segment.speakerLabel
    return startsTurn ? (byLabel.get(segment.speakerLabel!) ?? null) : null
  })
}

// A fixed palette (the --speaker-N tokens in index.css), picked by display order so a speaker keeps
// its colour within the job; it wraps around after the last one.
const PALETTE_SIZE = 8

export function speakerColour(speaker: Speaker): string {
  return `var(--speaker-${((speaker.displayOrder - 1) % PALETTE_SIZE) + 1})`
}
