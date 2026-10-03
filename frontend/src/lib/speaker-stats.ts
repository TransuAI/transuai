import type { Speaker, SpeakerInsight, TranscriptSegment } from '@/types/api'
import { hasMultipleSpeakers, speakersWithSegments } from '@/lib/speakers'

// 講者數據 (.scratch/speaker-analytics): the numbers worked out straight from the transcript's timeline — no AI, so
// they are exact and follow speaker edits at once. Cleared segments (已清空片段) count for nothing and don't end a
// turn, the same as where the transcript shows speaker names (see speakersAtTurns).

/** Gaps shorter than this between segments are ordinary pauses, not time nobody talks. */
export const SILENCE_GAP_SECONDS = 1
/** A speaker whose talk time is under this fraction of the average per speaker talks very little (發言很少). */
export const QUIET_FRACTION_OF_AVERAGE = 1 / 4

export interface SpeakerStats {
  speaker: Speaker
  talkSeconds: number
  /** Of everyone's talk time, 0–1. */
  share: number
  /** 發言次數: runs of this speaker's segments with nobody else in between. */
  turns: number
  longestTurnSeconds: number
  averageTurnSeconds: number
  quiet: boolean
}

export interface MeetingStats {
  /** Speakers with segments, in display order. */
  speakers: SpeakerStats[]
  totalTalkSeconds: number
  /** How many times the speaker changed. */
  speakerChanges: number
  /** Gaps between segments longer than SILENCE_GAP_SECONDS, added up. */
  silenceSeconds: number
}

/** Null when speakers aren't shown at all (fewer than two speakers; see hasMultipleSpeakers). */
export function computeSpeakerStats(segments: TranscriptSegment[], speakers: Speaker[]): MeetingStats | null {
  if (!hasMultipleSpeakers(segments)) return null
  const spoken = segments.filter((segment) => segment.text !== '').sort((a, b) => a.startTime - b.startTime)

  const turnsByLabel = new Map<string, number[]>()
  let previousLabel: string | null = null
  let speakerChanges = 0
  for (const segment of spoken) {
    const label = segment.speakerLabel
    if (label === null) continue
    const turns = turnsByLabel.get(label) ?? []
    const duration = segment.endTime - segment.startTime
    if (label === previousLabel) {
      turns[turns.length - 1] += duration
    } else {
      if (previousLabel !== null) speakerChanges += 1
      turns.push(duration)
    }
    turnsByLabel.set(label, turns)
    previousLabel = label
  }

  const talkOf = (label: string) => (turnsByLabel.get(label) ?? []).reduce((sum, turn) => sum + turn, 0)
  const listed = speakersWithSegments(spoken, speakers)
  const totalTalkSeconds = listed.reduce((sum, speaker) => sum + talkOf(speaker.label), 0)
  const quietBelow = (totalTalkSeconds / listed.length) * QUIET_FRACTION_OF_AVERAGE

  return {
    speakers: listed.map((speaker) => {
      const turns = turnsByLabel.get(speaker.label) ?? []
      const talkSeconds = talkOf(speaker.label)
      return {
        speaker,
        talkSeconds,
        share: totalTalkSeconds > 0 ? talkSeconds / totalTalkSeconds : 0,
        turns: turns.length,
        longestTurnSeconds: Math.max(0, ...turns),
        averageTurnSeconds: turns.length > 0 ? talkSeconds / turns.length : 0,
        quiet: talkSeconds < quietBelow,
      }
    }),
    totalTalkSeconds,
    speakerChanges,
    silenceSeconds: silence(spoken),
  }
}

function silence(spoken: TranscriptSegment[]): number {
  // Measured from the latest end so far: an earlier segment that runs past a shorter later one is still someone talking.
  let total = 0
  let talkingUntil = spoken[0]?.endTime ?? 0
  for (const segment of spoken.slice(1)) {
    const gap = segment.startTime - talkingUntil
    if (gap > SILENCE_GAP_SECONDS) total += gap
    talkingUntil = Math.max(talkingUntil, segment.endTime)
  }
  return total
}

/** 講者數據的 AI 判斷, split by kind (each list in time order, as the server sends them). */
export function insightsByKind(items: SpeakerInsight[]): { questions: SpeakerInsight[]; interruptions: SpeakerInsight[] } {
  return {
    questions: items.filter((item) => item.kind === 'question'),
    interruptions: items.filter((item) => item.kind === 'interruption'),
  }
}

/** The tile's one line: how many speakers and who talked most. */
export function speakerStatsStatus(stats: MeetingStats): string {
  const most = stats.speakers.reduce((top, row) => (row.talkSeconds > top.talkSeconds ? row : top))
  return `${stats.speakers.length} 位講者 · 講最多：${most.speaker.displayName}`
}
