import { describe, expect, it } from 'vitest'
import { computeSpeakerStats, speakerStatsStatus } from '@/lib/speaker-stats'
import type { Speaker, TranscriptSegment } from '@/types/api'

const speakers: Speaker[] = [
  { label: 'S1', displayName: '主持人', displayOrder: 1 },
  { label: 'S2', displayName: '講者 2', displayOrder: 2 },
  { label: 'S3', displayName: '講者 3', displayOrder: 3 },
]

let nextId = 0
function segment(speakerLabel: string | null, startTime: number, endTime: number, text = '說話'): TranscriptSegment {
  nextId += 1
  return { id: `seg-${nextId}`, startTime, endTime, speakerLabel, text, originalText: text }
}

const byLabel = (stats: ReturnType<typeof computeSpeakerStats>, label: string) =>
  stats!.speakers.find((s) => s.speaker.label === label)!

describe('computeSpeakerStats', () => {
  it('adds up each speaker’s talk time and their share of all talk', () => {
    const stats = computeSpeakerStats([
      segment('S1', 0, 30),
      segment('S2', 30, 40),
      segment('S1', 40, 70),
    ], speakers)

    expect(byLabel(stats, 'S1').talkSeconds).toBe(60)
    expect(byLabel(stats, 'S2').talkSeconds).toBe(10)
    expect(byLabel(stats, 'S1').share).toBeCloseTo(60 / 70)
    expect(stats!.totalTalkSeconds).toBe(70)
  })

  it('counts a run of the same speaker as one turn (發言次數), and the longest and average turn', () => {
    const stats = computeSpeakerStats([
      segment('S1', 0, 10),
      segment('S1', 10, 25), // same turn
      segment('S2', 25, 30),
      segment('S1', 30, 35),
    ], speakers)

    const host = byLabel(stats, 'S1')
    expect(host.turns).toBe(2)
    expect(host.longestTurnSeconds).toBe(25)
    expect(host.averageTurnSeconds).toBe(15)
    expect(byLabel(stats, 'S2').turns).toBe(1)
    expect(stats!.speakerChanges).toBe(2)
  })

  it('ignores cleared segments: they add no time and don’t split a turn', () => {
    const stats = computeSpeakerStats([
      segment('S1', 0, 10),
      segment('S2', 10, 20, ''), // cleared
      segment('S1', 20, 30),
      segment('S2', 30, 40),
    ], speakers)

    expect(byLabel(stats, 'S1').turns).toBe(1)
    expect(byLabel(stats, 'S1').talkSeconds).toBe(20)
    expect(byLabel(stats, 'S2').talkSeconds).toBe(10)
  })

  it('adds up the time nobody talks, counting only gaps over a second', () => {
    const stats = computeSpeakerStats([
      segment('S1', 0, 10),
      segment('S2', 10.5, 20), // 0.5s: a normal pause
      segment('S1', 25, 30), // 5s of silence
      segment('S2', 33, 40), // 3s
    ], speakers)

    expect(stats!.silenceSeconds).toBe(8)
  })

  it('doesn’t count time someone is still talking as silence, when an earlier segment runs past a later one', () => {
    const stats = computeSpeakerStats([
      segment('S1', 0, 20),
      segment('S2', 5, 8), // inside S1's segment
      segment('S1', 21, 25), // 1s after S1 stopped: an ordinary pause, not 13s of silence
    ], speakers)

    expect(stats!.silenceSeconds).toBe(0)
  })

  it('flags a speaker who talks less than a quarter of the average per speaker (發言很少)', () => {
    const stats = computeSpeakerStats([
      segment('S1', 0, 100),
      segment('S2', 100, 190),
      segment('S3', 190, 200), // 10s; average is 200/3 ≈ 66.7s, a quarter ≈ 16.7s
    ], speakers)

    expect(byLabel(stats, 'S3').quiet).toBe(true)
    expect(byLabel(stats, 'S2').quiet).toBe(false)
  })

  it('lists only speakers with segments, in display order', () => {
    const stats = computeSpeakerStats([
      segment('S2', 0, 10),
      segment('S1', 10, 20),
    ], speakers)

    expect(stats!.speakers.map((s) => s.speaker.label)).toEqual(['S1', 'S2'])
  })

  it('is null when speakers aren’t shown (one speaker, or no speaker information)', () => {
    expect(computeSpeakerStats([segment('S1', 0, 10), segment('S1', 10, 20)], speakers)).toBeNull()
    expect(computeSpeakerStats([segment(null, 0, 10)], [])).toBeNull()
  })

  it('leaves segments without a speaker out of everyone’s time', () => {
    const stats = computeSpeakerStats([
      segment('S1', 0, 10),
      segment(null, 10, 20),
      segment('S2', 20, 30),
    ], speakers)

    expect(stats!.totalTalkSeconds).toBe(20)
  })
})

describe('speakerStatsStatus', () => {
  it('names who talked most', () => {
    const stats = computeSpeakerStats([segment('S1', 0, 4), segment('S2', 4, 5), segment('S1', 5, 9)], speakers)!

    expect(speakerStatsStatus(stats)).toBe('2 位講者 · 講最多：主持人')
  })

  it('says so instead of failing when there are no speakers', () => {
    expect(speakerStatsStatus({ speakers: [], totalTalkSeconds: 0, speakerChanges: 0, silenceSeconds: 0 })).toBe('沒有講者')
  })
})
