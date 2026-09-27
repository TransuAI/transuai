import { describe, expect, it } from 'vitest'
import {
  exportFileName,
  formatClock,
  buildExportContent,
  markdownReportFormat,
  toMarkdownReport,
  toQuizMarkdown,
  toPlainText,
  toSrt,
  toTimestampedText,
  toVtt,
  type ExportContent,
  type ExportSegment,
} from '@/lib/export-formats'

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

const conversation = [
  segment(0, 2.5, '大家好', '王小明'),
  segment(2.5, 4, '今天來聊預算', '王小明'),
  segment(4, 6, '', '李小華'),
  segment(6, 3605, '好的', '李小華'),
]

describe('toVtt', () => {
  it('writes a WEBVTT file with dot-separated milliseconds and no BOM', () => {
    const vtt = toVtt([segment(5, 8, '第一句'), segment(8, 10.5, '第二句')])

    expect(vtt).toBe('WEBVTT\n\n00:00:05.000 --> 00:00:08.000\n第一句\n\n00:00:08.000 --> 00:00:10.500\n第二句\n\n')
  })

  it('marks who is speaking with a voice span when two or more speakers are talking, and skips cleared segments', () => {
    expect(toVtt(conversation)).toBe(
      'WEBVTT\n\n' +
        '00:00:00.000 --> 00:00:02.500\n<v 王小明>大家好\n\n' +
        '00:00:02.500 --> 00:00:04.000\n<v 王小明>今天來聊預算\n\n' +
        '00:00:06.000 --> 01:00:05.000\n<v 李小華>好的\n\n',
    )
  })

  it('escapes characters that WebVTT would read as markup, in the text and in the voice name', () => {
    const vtt = toVtt([segment(0, 2, 'A<B & C>D', 'R&D <1>'), segment(2, 4, '好', '王小明')])

    expect(vtt).toContain('<v R&amp;D &lt;1&gt;>A&lt;B &amp; C&gt;D\n')
  })

  it('does not use voice spans for a single speaker', () => {
    expect(toVtt([segment(0, 2, '大家好', '講者 1'), segment(2, 4, '開始吧', '講者 1')])).not.toContain('<v')
  })
})

describe('toPlainText', () => {
  it('puts one segment per line', () => {
    expect(toPlainText([segment(0, 2, '第一句'), segment(2, 4, '第二句')])).toBe('第一句\n第二句\n')
  })

  it('names the speaker only on the line where the speaker changes, and skips cleared segments', () => {
    expect(toPlainText(conversation)).toBe('王小明：大家好\n今天來聊預算\n李小華：好的\n')
  })
})

describe('text formats with a single speaker', () => {
  const monologue = [segment(0, 2, '大家好', '講者 1'), segment(2, 4, '開始吧', '講者 1')]

  it.each([
    ['toPlainText', toPlainText],
    ['toTimestampedText', toTimestampedText],
  ])('%s does not label anyone', (_name, render) => {
    expect(render(monologue)).not.toContain('講者 1')
  })
})

describe('toTimestampedText', () => {
  it('starts every line with the segment start time', () => {
    expect(toTimestampedText([segment(5, 8, '第一句'), segment(3725, 3727, '一小時後')])).toBe(
      '[00:05] 第一句\n[1:02:05] 一小時後\n',
    )
  })

  it('names the speaker only on the line where the speaker changes', () => {
    expect(toTimestampedText(conversation)).toBe('[00:00] 王小明：大家好\n[00:02] 今天來聊預算\n[00:06] 李小華：好的\n')
  })
})

describe('toMarkdownReport', () => {
  const content: ExportContent = {
    fileName: '週會.m4a',
    durationSeconds: 3725,
    // Built from local date parts so the expected local time below holds in any time zone.
    createdAt: new Date(2026, 8, 1, 9, 5).toISOString(),
    segments: [segment(0, 2, '大家好', '王小明'), segment(2, 4, '', '王小明'), segment(400, 402, '預算要再確認', '李小華')],
    summary: { text: '討論了預算。', isStale: false },
    chapters: [
      { title: '開場', startTime: 0 },
      { title: '預算', startTime: 400 },
    ],
    qaHistory: [],
  }

  it('writes the title, job info, summary, chapters and transcript in that order', () => {
    expect(toMarkdownReport(content)).toBe(
      [
        '# 週會.m4a',
        '',
        '- 長度：1:02:05',
        '- 建立時間：2026-09-01 09:05',
        '',
        '## 摘要',
        '',
        '討論了預算。',
        '',
        '## 章節',
        '',
        '- [00:00] 開場',
        '- [06:40] 預算',
        '',
        '## 逐字稿',
        '',
        '[00:00] 王小明：大家好',
        '',
        '[06:40] 李小華：預算要再確認',
        '',
      ].join('\n'),
    )
  })

  it('flags a summary that is 過時 (the transcript was edited after it was generated)', () => {
    const report = toMarkdownReport({ ...content, summary: { text: '討論了預算。', isStale: true } })

    expect(report).toContain('## 摘要\n\n> 逐字稿在摘要產生後有修改，摘要與章節可能過時\n\n討論了預算。\n')
  })

  it('still exports when there is no summary or no chapters yet', () => {
    const report = toMarkdownReport({ ...content, summary: null, chapters: [] })

    expect(report).toContain('## 摘要\n\n尚無摘要\n')
    expect(report).toContain('## 章節\n\n尚無章節\n')
  })

  it('appends the Q&A history, with the cited timestamps, when it is included', () => {
    const report = toMarkdownReport({
      ...content,
      qaHistory: [{ question: '預算怎麼了?', answer: '要再確認。', sourceTimestamps: [400, 3725] }],
    })

    expect(report.endsWith('## 問答紀錄\n\n### 預算怎麼了?\n\n要再確認。\n\n引用：[06:40]、[1:02:05]\n')).toBe(true)
  })

  it('keeps a multi-line question on its heading line', () => {
    const report = toMarkdownReport({ ...content, qaHistory: [{ question: '第一行\n第二行', answer: '答', sourceTimestamps: [] }] })

    expect(report).toContain('### 第一行 第二行\n\n答\n')
  })

  it('leaves the Q&A history out of the report unless asked to include it', () => {
    const withQa = { ...content, qaHistory: [{ question: '問?', answer: '答', sourceTimestamps: [] }] }

    expect(markdownReportFormat({ includeQa: false }).render(withQa)).not.toContain('## 問答紀錄')
    expect(markdownReportFormat({ includeQa: true }).render(withQa)).toContain('## 問答紀錄')
  })
})

describe('buildExportContent', () => {
  it('only exports Q&A turns whose answer has finished', () => {
    const content = buildExportContent({
      job: { jobId: 'job-1', userId: 'u', fileName: 'a.mp3', fileType: 'AUDIO', fileSizeBytes: 1, storagePath: 'p', durationSeconds: 1, status: 'COMPLETED', errorReason: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', transcriptionLanguage: 'zh-TW' },
      transcript: null,
      summary: null,
      chapters: [],
      qaHistory: [
        { question: '完成的', answer: '答', sourceTimestamps: [], status: 'done' },
        { question: '還在串流', answer: '答…', sourceTimestamps: [], status: 'streaming' },
        { question: '失敗的', answer: '', sourceTimestamps: [], status: 'error' },
      ],
    })

    expect(content.qaHistory.map((turn) => turn.question)).toEqual(['完成的'])
  })
})

describe('toQuizMarkdown', () => {
  const quiz = {
    fileName: '光合作用.mp3',
    // Built from local date parts so the expected local time below holds in any time zone.
    madeAt: new Date(2026, 8, 26, 14, 7).toISOString(),
    isStale: false,
    questions: [
      {
        kind: 'multiple_choice' as const,
        prompt: '光能被什麼吸收？',
        options: ['粒線體', '葉綠體', '細胞核', '液泡'],
        correctOption: 1,
        explanation: '講者說葉綠體吸收光能。',
        sourceTimestamps: [20.5, 65],
      },
      {
        kind: 'true_false' as const,
        prompt: '今天講的是光合作用。',
        options: ['是', '否'],
        correctOption: 0,
        explanation: '開場就說了。',
        sourceTimestamps: [],
      },
    ],
  }

  it('puts the questions and their options first and the answers with explanations in a last section', () => {
    expect(toQuizMarkdown(quiz)).toBe(
      [
        '# 光合作用.mp3：測驗',
        '',
        '- 題數：2',
        '- 產生時間：2026-09-26 14:07',
        '',
        '## 題目',
        '',
        '### 1. 光能被什麼吸收？',
        '',
        '- A. 粒線體',
        '- B. 葉綠體',
        '- C. 細胞核',
        '- D. 液泡',
        '',
        '### 2. 今天講的是光合作用。',
        '',
        '- A. 是',
        '- B. 否',
        '',
        '## 解答',
        '',
        '### 1. B. 葉綠體',
        '',
        '講者說葉綠體吸收光能。',
        '',
        '依據：[00:20]、[01:05]',
        '',
        '### 2. A. 是',
        '',
        '開場就說了。',
        '',
      ].join('\n'),
    )
  })

  it('flags a quiz made before the transcript was last edited', () => {
    expect(toQuizMarkdown({ ...quiz, isStale: true })).toContain(
      '- 產生時間：2026-09-26 14:07\n\n> 逐字稿在測驗產生後有修改，這份測驗可能過時\n\n## 題目',
    )
  })

  it('keeps a multi-line question on its heading line', () => {
    const multiLine = { ...quiz, questions: [{ ...quiz.questions[1], prompt: '第一行\n第二行' }] }

    expect(toQuizMarkdown(multiLine)).toContain('### 1. 第一行 第二行\n')
  })
})
