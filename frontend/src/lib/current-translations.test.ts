import { describe, expect, it } from 'vitest'
import { currentTranslations } from '@/lib/current-translations'

describe('currentTranslations', () => {
  const transcript = {
    segments: [
      { id: 'a', startTime: 0, endTime: 1, speakerLabel: null, text: 'Hi.', originalText: 'Hi.' },
      { id: 'b', startTime: 1, endTime: 2, speakerLabel: null, text: 'Budget second.', originalText: 'Budget first.' },
      { id: 'c', startTime: 2, endTime: 3, speakerLabel: null, text: '', originalText: 'Okay.' },
    ],
  }

  it('keeps only translations made from the text the segment has now', () => {
    const translated = [
      { segmentId: 'a', text: '嗨。', sourceText: 'Hi.' },
      { segmentId: 'b', text: '先談預算。', sourceText: 'Budget first.' }, // edited since
      { segmentId: 'c', text: '好。', sourceText: 'Okay.' }, // cleared since
      { segmentId: 'gone', text: '？', sourceText: '?' },
    ]

    expect(currentTranslations(translated, transcript)).toEqual(new Map([['a', '嗨。']]))
  })

  it('has nothing without a transcript', () => {
    expect(currentTranslations([{ segmentId: 'a', text: '嗨。', sourceText: 'Hi.' }], null).size).toBe(0)
  })
})
