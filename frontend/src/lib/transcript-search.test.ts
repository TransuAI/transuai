import { describe, expect, it } from 'vitest'
import { findTranscriptMatches } from '@/lib/transcript-search'
import type { TranscriptSegment } from '@/types/api'

const segment = (id: string, text: string): TranscriptSegment => ({ id, startTime: 0, endTime: 1, speakerLabel: null, text, originalText: text })

describe('findTranscriptMatches with a translation under each segment (雙語)', () => {
  it('finds a match in the translation as well as the original, original first', () => {
    const segments = [segment('a', '預算 budget'), segment('b', '下一步')]

    const matches = findTranscriptMatches(segments, 'budget', ['The budget', 'Next step'])

    expect(matches).toEqual([
      { segmentIndex: 0, start: 3, end: 9 },
      { segmentIndex: 0, start: 4, end: 10, inTranslation: true },
    ])
  })

  it('searches only the originals without translations', () => {
    expect(findTranscriptMatches([segment('a', 'Budget')], 'budget')).toEqual([{ segmentIndex: 0, start: 0, end: 6 }])
  })
})
