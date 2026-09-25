import { describe, expect, it } from 'vitest'
import { exportFileName, formatClock, toSrt, type ExportSegment } from '@/lib/export-formats'

function segment(startTime: number, endTime: number, text: string, speakerName: string | null = null): ExportSegment {
  return { startTime, endTime, text, speakerName }
}

describe('toSrt', () => {
  it('writes one numbered cue per segment, with a UTF-8 BOM for older Windows tools', () => {
    const srt = toSrt([segment(5, 8, '第一句'), segment(8, 10.5, '第二句')])

    expect(srt).toBe(
      '\uFEFF' +
        '1\n00:00:05,000 --> 00:00:08,000\n第一句\n\n' +
        '2\n00:00:08,000 --> 00:00:10,500\n第二句\n\n',
    )
  })
})

describe('toSrt shared export rules', () => {
  it('writes timecodes past one hour with hours and rounded milliseconds', () => {
    const srt = toSrt([segment(3725.4996, 3727.25, '一小時後')])

    expect(srt).toContain('1\n01:02:05,500 --> 01:02:07,250\n一小時後\n')
  })

  it('leaves out cleared segments (empty text) and keeps the cue numbers consecutive', () => {
    const srt = toSrt([segment(0, 2, '保留一'), segment(2, 4, ''), segment(4, 6, '保留二')])

    expect(srt).toBe(
      '\uFEFF' +
        '1\n00:00:00,000 --> 00:00:02,000\n保留一\n\n' +
        '2\n00:00:04,000 --> 00:00:06,000\n保留二\n\n',
    )
  })

  it('prefixes every cue with the speaker name when two or more speakers are talking', () => {
    const srt = toSrt([segment(0, 2, '大家好', '王小明'), segment(2, 4, '你好', '李小華'), segment(4, 6, '開始吧', '王小明')])

    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,000\n王小明：大家好\n')
    expect(srt).toContain('2\n00:00:02,000 --> 00:00:04,000\n李小華：你好\n')
    expect(srt).toContain('3\n00:00:04,000 --> 00:00:06,000\n王小明：開始吧\n')
  })

  it('does not label anyone when only one speaker is talking', () => {
    const srt = toSrt([segment(0, 2, '大家好', '講者 1'), segment(2, 4, '今天來聊聊', '講者 1')])

    expect(srt).not.toContain('講者 1')
  })

  it('only counts speakers who still have text, so a cleared line cannot make it look multi-speaker', () => {
    const srt = toSrt([segment(0, 2, '大家好', '講者 1'), segment(2, 4, '', '講者 2'), segment(4, 6, '開始吧', '講者 1')])

    expect(srt).not.toContain('講者')
  })
})

describe('exportFileName', () => {
  it.each([
    ['interview.mp3', 'interview.srt'],
    ['週會 2026.09.25.m4a', '週會 2026.09.25.srt'],
    ['no-extension', 'no-extension.srt'],
  ])('names the export after the uploaded file without its extension (%s)', (original, expected) => {
    expect(exportFileName(original, '.srt')).toBe(expected)
  })

  it('appends a suffix before the extension when one format has two variants', () => {
    expect(exportFileName('interview.mp3', '-含時間戳.txt')).toBe('interview-含時間戳.txt')
  })
})

describe('formatClock', () => {
  it.each([
    [0, '00:00'],
    [5.9, '00:05'],
    [754, '12:34'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725.5, '1:02:05'],
  ])('writes %s seconds as %s (mm:ss under an hour, h:mm:ss from an hour on)', (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected)
  })
})
