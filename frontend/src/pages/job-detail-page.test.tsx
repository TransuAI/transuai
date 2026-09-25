import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chapterApi, jobsApi, qaApi, summaryApi, transcriptApi } from '@/lib/api'
import type { Chapter, Job, QaTurn, Summary, Transcript } from '@/types/api'

vi.mock('@/lib/api', () => ({
  jobsApi: {
    get: vi.fn(),
    getMediaUrl: vi
      .fn()
      .mockResolvedValue({ downloadUrl: 'https://media.example.com/uploads/interview.mp3', expiresAt: '2026-01-01T01:00:00Z' }),
  },
  transcriptApi: { get: vi.fn() },
  summaryApi: { get: vi.fn() },
  chapterApi: { list: vi.fn() },
  qaApi: { ask: vi.fn(), history: vi.fn() },
}))

vi.mock('@/hooks/use-job-socket', () => ({
  useJobSocket: vi.fn(),
}))

let JobDetailPage: typeof import('./job-detail-page').JobDetailPage

afterEach(() => {
  vi.restoreAllMocks()
})

beforeAll(async () => {
  ;({ JobDetailPage } = await import('./job-detail-page'))
})

function renderJobDetail(jobId = 'job-1') {
  return render(
    <MemoryRouter initialEntries={[`/jobs/${jobId}`]}>
      <Routes>
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const baseJob: Job = {
  jobId: 'job-1',
  userId: 'user-1',
  fileName: 'interview.mp3',
  fileType: 'AUDIO',
  fileSizeBytes: 2 * 1024 * 1024,
  storagePath: 'uploads/interview.mp3',
  durationSeconds: 300,
  status: 'TRANSCRIBING',
  errorReason: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const mockTranscript: Transcript = {
  jobId: 'job-1',
  language: 'zh',
  fullText: 'hello world',
  segments: [{ startTime: 5, endTime: 8, speakerLabel: 'A', text: '哈囉世界' }],
}

const mockSummary: Summary = { jobId: 'job-1', summaryText: '這是摘要內容' }

const mockChapters: Chapter[] = [{ id: 'ch-1', jobId: 'job-1', title: '開場', startTime: 12, sequenceNo: 0 }]

async function renderCompletedJob(
  transcript: Transcript = mockTranscript,
  qaHistory: QaTurn[] = [],
  job: Partial<Job> = {},
) {
  vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, ...job, status: 'COMPLETED' })
  vi.mocked(transcriptApi.get).mockResolvedValue(transcript)
  vi.mocked(summaryApi.get).mockResolvedValue(mockSummary)
  vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)
  vi.mocked(qaApi.history).mockResolvedValue(qaHistory)

  const view = renderJobDetail()
  await screen.findByText('問答')
  return view
}

function stubDesktopLayout() {
  return vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: query === '(min-width: 1024px)',
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

// Like stubDesktopLayout, but the viewport can be switched mid-test; useMediaQuery listens
// for the change and the workspace swaps layouts.
function stubSwitchableLayout(initiallyDesktop: boolean) {
  let isDesktop = initiallyDesktop
  const listeners = new Set<() => void>()
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        get matches() {
          return query === '(min-width: 1024px)' && isDesktop
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
  return {
    switchTo(desktop: boolean) {
      isDesktop = desktop
      act(() => listeners.forEach((listener) => listener()))
    },
  }
}

describe('JobDetailPage status branches', () => {
  it('shows the simplified progress view for a non-COMPLETED job, without the three-pane workspace', async () => {
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'TRANSCRIBING' })

    renderJobDetail()

    expect(await screen.findByText('轉錄中')).toBeInTheDocument()
    expect(screen.getByText('處理中,完成後這裡會自動更新逐字稿與摘要...')).toBeInTheDocument()
    expect(screen.queryByText('問答')).not.toBeInTheDocument()
    expect(screen.queryByText('Studio')).not.toBeInTheDocument()
  })

  it('shows the failure reason for a FAILED job', async () => {
    vi.mocked(jobsApi.get).mockResolvedValue({
      ...baseJob,
      status: 'FAILED',
      errorReason: '轉錄服務逾時',
    })

    renderJobDetail()

    expect(await screen.findByText('處理失敗')).toBeInTheDocument()
    expect(screen.getByText('轉錄服務逾時')).toBeInTheDocument()
  })

  it('shows the Chat pane by default for a COMPLETED job, with Source/Studio reachable via triggers', async () => {
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'COMPLETED' })
    vi.mocked(transcriptApi.get).mockResolvedValue(mockTranscript)
    vi.mocked(summaryApi.get).mockResolvedValue(mockSummary)
    vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)
    vi.mocked(qaApi.history).mockResolvedValue([])

    renderJobDetail()

    expect(await screen.findByText('問答')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '來源' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Studio' })).toBeInTheDocument()
  })
})

describe('JobDetailPage Source/Studio Sheets (COMPLETED, narrow viewport)', () => {
  it('opens the Source Sheet when the Source trigger is clicked', async () => {
    const user = userEvent.setup()
    await renderCompletedJob()

    expect(screen.queryByText('哈囉世界', { exact: false })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '來源' }))

    expect(await screen.findByText('哈囉世界', { exact: false })).toBeInTheDocument()
  })

  it('opens the Studio Sheet when the Studio trigger is clicked', async () => {
    const user = userEvent.setup()
    await renderCompletedJob()

    expect(screen.queryByText('這是摘要內容')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Studio' }))

    expect(await screen.findByText('這是摘要內容')).toBeInTheDocument()
    expect(screen.getByText('開場')).toBeInTheDocument()
  })
})

// On narrow viewports the Source/Studio panes live in modal Sheets, so the transcript and
// the chapter list aren't on screen together with the Chat pane. These tests force the
// desktop layout, where Source/Chat/Studio render inline simultaneously, to exercise the
// carried-over ask -> history -> citation-seek and segment/chapter-seek behavior.
describe('JobDetailPage Chat pane (COMPLETED, desktop layout)', () => {
  it('asks a question, appends it to history, and seeks the media player from a citation timestamp', async () => {
    const matchMediaSpy = stubDesktopLayout()
    const user = userEvent.setup()
    vi.mocked(qaApi.ask).mockImplementation(async (_jobId, _question, handlers) => {
      handlers.onSources([42])
      handlers.onDelta('答案內容')
    })

    await renderCompletedJob()

    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), '這段在說什麼?')
    await user.click(screen.getByRole('button', { name: '問' }))

    expect(qaApi.ask).toHaveBeenCalledWith(
      'job-1',
      '這段在說什麼?',
      expect.objectContaining({
        onSources: expect.any(Function),
        onDelta: expect.any(Function),
        onError: expect.any(Function),
      }),
    )
    expect(await screen.findByText('這段在說什麼?')).toBeInTheDocument()
    expect(screen.getByText('答案內容')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '0:42' }))

    const audio = document.querySelector('audio')
    expect(audio).not.toBeNull()
    expect(audio?.currentTime).toBe(42)

    matchMediaSpy.mockRestore()
  })

  it('seeks the media player when a transcript segment is clicked', async () => {
    const matchMediaSpy = stubDesktopLayout()
    const user = userEvent.setup()

    await renderCompletedJob()
    await user.click(await screen.findByRole('button', { name: '0:05' }))

    const audio = document.querySelector('audio')
    expect(audio?.currentTime).toBe(5)

    matchMediaSpy.mockRestore()
  })

  it('seeks the media player when a chapter is clicked', async () => {
    const matchMediaSpy = stubDesktopLayout()
    const user = userEvent.setup()

    await renderCompletedJob()
    await user.click(await screen.findByRole('button', { name: '0:12開場' }))

    const audio = document.querySelector('audio')
    expect(audio?.currentTime).toBe(12)

    matchMediaSpy.mockRestore()
  })
})

// The segments deliberately leave a 10–12s gap to exercise the gap rule of the current
// segment (目前片段, see frontend CONTEXT.md).
const gappedTranscript: Transcript = {
  jobId: 'job-1',
  language: 'Chinese',
  fullText: '第一句 第二句 第三句',
  segments: [
    { startTime: 5, endTime: 8, speakerLabel: null, text: '第一句' },
    { startTime: 8, endTime: 10, speakerLabel: null, text: '第二句' },
    { startTime: 12, endTime: 15, speakerLabel: null, text: '第三句' },
  ],
}

async function renderGappedTranscriptOnDesktop(qaHistory: QaTurn[] = []) {
  stubDesktopLayout()
  await renderCompletedJob(gappedTranscript, qaHistory)
  await screen.findByText('第一句')
  return renderedMediaElement()
}

function searchbox() {
  return screen.getByRole('searchbox', { name: '搜尋逐字稿' })
}

function renderedMediaElement() {
  const media = document.querySelector('audio')
  if (!media) throw new Error('media element not rendered')
  return media
}

function playTo(media: HTMLMediaElement, seconds: number) {
  media.currentTime = seconds
  fireEvent.timeUpdate(media)
}

function currentSegmentText() {
  return document.querySelector('[aria-current="true"]')?.textContent ?? null
}

describe('JobDetailPage current segment (COMPLETED, desktop layout)', () => {
  it('marks the segment whose time range contains the playback time as the current segment', async () => {
    const media = await renderGappedTranscriptOnDesktop()

    playTo(media, 9)

    expect(currentSegmentText()).toContain('第二句')
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  })

  it('keeps the previous segment as current while playback is in a gap between two segments', async () => {
    const media = await renderGappedTranscriptOnDesktop()

    playTo(media, 11)

    expect(currentSegmentText()).toContain('第二句')
  })

  it('has no current segment before the first segment starts', async () => {
    const media = await renderGappedTranscriptOnDesktop()

    playTo(media, 2)

    expect(currentSegmentText()).toBeNull()
  })

  it('has no current segment after the last segment ends', async () => {
    const media = await renderGappedTranscriptOnDesktop()

    playTo(media, 20)

    expect(currentSegmentText()).toBeNull()
  })

  it('moves the current segment immediately when a transcript timestamp is clicked', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '0:12' }))

    expect(currentSegmentText()).toContain('第三句')
  })

  it('moves the current segment when the user seeks with the player', async () => {
    const media = await renderGappedTranscriptOnDesktop()
    playTo(media, 6)

    media.currentTime = 13
    fireEvent.seeked(media)

    expect(currentSegmentText()).toContain('第三句')
  })
})

describe('JobDetailPage current segment (COMPLETED, narrow viewport)', () => {
  async function openSourceSheet(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: '來源' }))
    await screen.findByText('第一句')
    return renderedMediaElement()
  }

  it('highlights the current segment inside the Source Sheet too', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(gappedTranscript)
    const media = await openSourceSheet(user)

    playTo(media, 13)

    expect(currentSegmentText()).toContain('第三句')
  })

  it('keeps the same player, and so the current segment, when the Source Sheet is closed and reopened', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(gappedTranscript)
    const media = renderedMediaElement()
    await openSourceSheet(user)
    playTo(media, 13)

    await user.keyboard('{Escape}')
    await openSourceSheet(user)

    expect(renderedMediaElement()).toBe(media)
    expect(currentSegmentText()).toContain('第三句')
  })
})

describe('JobDetailPage auto-follow (COMPLETED, desktop layout)', () => {
  async function renderPlayingAt(seconds: number) {
    const media = await renderGappedTranscriptOnDesktop([
      { question: '第三句在說什麼?', answer: '在說第三句', sourceTimestamps: [13], createdAt: '2026-01-01T00:00:00Z' },
    ])
    playTo(media, seconds)
    return media
  }

  it('pauses auto-follow and offers a way back when the user scrolls the transcript', async () => {
    await renderPlayingAt(9)
    expect(screen.queryByRole('button', { name: '回到播放位置' })).not.toBeInTheDocument()

    fireEvent.wheel(screen.getByText('第一句'))

    expect(screen.getByRole('button', { name: '回到播放位置' })).toBeInTheDocument()
  })

  it('resumes auto-follow when the user asks to go back to the playback position', async () => {
    const user = userEvent.setup()
    await renderPlayingAt(9)
    fireEvent.wheel(screen.getByText('第一句'))

    await user.click(screen.getByRole('button', { name: '回到播放位置' }))

    expect(screen.queryByRole('button', { name: '回到播放位置' })).not.toBeInTheDocument()
  })

  it.each([
    ['a transcript timestamp', '0:05'],
    ['a chapter', '0:12開場'],
    ['a Q&A citation', '0:13'],
  ])('resumes auto-follow when the user jumps to %s', async (_what, buttonName) => {
    const user = userEvent.setup()
    await renderPlayingAt(9)
    fireEvent.wheel(screen.getByText('第一句'))

    await user.click(screen.getByRole('button', { name: buttonName }))

    expect(screen.queryByRole('button', { name: '回到播放位置' })).not.toBeInTheDocument()
  })

  it('does not offer the way back while there is no current segment', async () => {
    await renderPlayingAt(2)

    fireEvent.wheel(screen.getByText('第一句'))

    expect(screen.queryByRole('button', { name: '回到播放位置' })).not.toBeInTheDocument()
  })

  it('pauses auto-follow when the user scrolls the transcript by touch', async () => {
    await renderPlayingAt(9)

    fireEvent.touchMove(screen.getByText('第一句'))

    expect(screen.getByRole('button', { name: '回到播放位置' })).toBeInTheDocument()
  })

  it.each(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '])(
    'pauses auto-follow when the user clicks into the transcript and scrolls with the %j key',
    async (key) => {
      const user = userEvent.setup()
      await renderPlayingAt(9)

      await user.click(screen.getByText('第一句'))
      await user.keyboard(key === ' ' ? '{ }' : `{${key}}`)

      expect(screen.getByRole('button', { name: '回到播放位置' })).toBeInTheDocument()
    },
  )

  it('treats Space on a focused timestamp as a click (a jump), not as scrolling', async () => {
    const user = userEvent.setup()
    await renderPlayingAt(9)
    fireEvent.wheel(screen.getByText('第一句'))

    screen.getByRole('button', { name: '0:05' }).focus()
    await user.keyboard('{ }')

    expect(screen.queryByRole('button', { name: '回到播放位置' })).not.toBeInTheDocument()
  })

  it('does not treat ctrl+wheel (zooming the page) as scrolling the transcript', async () => {
    await renderPlayingAt(9)

    fireEvent.wheel(screen.getByText('第一句'), { ctrlKey: true })

    expect(screen.queryByRole('button', { name: '回到播放位置' })).not.toBeInTheDocument()
  })

  it('resumes auto-follow when the user seeks with the player itself', async () => {
    const media = await renderPlayingAt(9)
    fireEvent.wheel(screen.getByText('第一句'))

    media.currentTime = 13
    fireEvent.seeked(media)

    expect(screen.queryByRole('button', { name: '回到播放位置' })).not.toBeInTheDocument()
  })

  it('keeps following when the user presses a key that does not scroll', async () => {
    const user = userEvent.setup()
    await renderPlayingAt(9)

    await user.click(screen.getByText('第一句'))
    await user.keyboard('{Tab}')

    expect(screen.queryByRole('button', { name: '回到播放位置' })).not.toBeInTheDocument()
  })
})

const searchableTranscript: Transcript = {
  jobId: 'job-1',
  language: 'Chinese',
  fullText: '',
  segments: [
    { startTime: 0, endTime: 4, speakerLabel: null, text: '今天先討論預算' },
    { startTime: 4, endTime: 8, speakerLabel: null, text: '下一季的預算要再確認一次預算上限' },
    { startTime: 8, endTime: 12, speakerLabel: null, text: '文件放在 API 規格裡' },
    { startTime: 12, endTime: 16, speakerLabel: null, text: 'api 的版本下週定案' },
  ],
}

describe('JobDetailPage transcript search (COMPLETED, desktop layout)', () => {
  async function renderSearchable() {
    stubDesktopLayout()
    await renderCompletedJob(searchableTranscript)
    await screen.findByText('今天先討論預算', { exact: false })
    return renderedMediaElement()
  }

  function highlightedMatches() {
    return [...document.querySelectorAll('mark')].map((mark) => mark.textContent)
  }

  it('highlights every match in the transcript and shows which match is selected', async () => {
    const user = userEvent.setup()
    await renderSearchable()

    await user.type(searchbox(), '預算')

    expect(highlightedMatches()).toEqual(['預算', '預算', '預算'])
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('steps through matches with the next / previous buttons, wrapping around at either end', async () => {
    const user = userEvent.setup()
    await renderSearchable()
    await user.type(searchbox(), '預算')

    await user.click(screen.getByRole('button', { name: '下一個符合結果' }))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下一個符合結果' }))
    await user.click(screen.getByRole('button', { name: '下一個符合結果' }))
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '上一個符合結果' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('moves to the next match on Enter and the previous one on Shift+Enter', async () => {
    const user = userEvent.setup()
    await renderSearchable()
    const input = searchbox()
    await user.type(input, '預算')

    await user.type(input, '{Enter}')
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    await user.type(input, '{Shift>}{Enter}{/Shift}')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('clears the search on Escape', async () => {
    const user = userEvent.setup()
    await renderSearchable()
    const input = searchbox()
    await user.type(input, '預算')

    await user.type(input, '{Escape}')

    expect(input).toHaveValue('')
    expect(highlightedMatches()).toEqual([])
    expect(screen.queryByText('1 / 3')).not.toBeInTheDocument()
  })

  it('only scrolls between matches, without moving the playback position', async () => {
    const user = userEvent.setup()
    const media = await renderSearchable()
    playTo(media, 1)
    await user.type(searchbox(), '預算')

    await user.click(screen.getByRole('button', { name: '下一個符合結果' }))
    await user.click(screen.getByRole('button', { name: '下一個符合結果' }))

    expect(media.currentTime).toBe(1)
  })

  it('pauses auto-follow as soon as the user types a query, and clearing it does not resume', async () => {
    const user = userEvent.setup()
    const media = await renderSearchable()
    playTo(media, 1)
    const input = searchbox()
    expect(screen.queryByRole('button', { name: '回到播放位置' })).not.toBeInTheDocument()

    await user.type(input, '預')
    expect(screen.getByRole('button', { name: '回到播放位置' })).toBeInTheDocument()

    await user.clear(input)
    expect(screen.getByRole('button', { name: '回到播放位置' })).toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    await renderSearchable()

    await user.type(searchbox(), '颱風')

    expect(screen.getByText('沒有符合的結果')).toBeInTheDocument()
  })

  it('matches English case-insensitively', async () => {
    const user = userEvent.setup()
    await renderSearchable()

    await user.type(searchbox(), 'api')

    expect(highlightedMatches()).toEqual(['API', 'api'])
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('keeps auto-follow paused while stepping between matches, even after jumping to one of them', async () => {
    const user = userEvent.setup()
    await renderSearchable()
    const input = searchbox()
    await user.type(input, '預算')
    await user.click(screen.getByRole('button', { name: '0:04' })) // jump to a match: resumes auto-follow

    await user.type(input, '{Enter}')

    expect(screen.getByRole('button', { name: '回到播放位置' })).toBeInTheDocument()
  })
})

describe('JobDetailPage transcript search (COMPLETED, narrow viewport)', () => {
  it('clears a non-empty search on Escape without closing the Source Sheet', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(searchableTranscript)
    await user.click(screen.getByRole('button', { name: '來源' }))
    const input = await screen.findByRole('searchbox', { name: '搜尋逐字稿' })
    await user.type(input, '預算')

    await user.keyboard('{Escape}')

    expect(searchbox()).toHaveValue('')
    expect(within(screen.getByRole('dialog')).getByText('今天先討論預算')).toBeInTheDocument()
  })

  it('still closes the Source Sheet on Escape when the search box is empty', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(searchableTranscript)
    await user.click(screen.getByRole('button', { name: '來源' }))
    await user.click(await screen.findByRole('searchbox', { name: '搜尋逐字稿' }))

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('searchbox', { name: '搜尋逐字稿' })).not.toBeInTheDocument()
  })

  it('does not focus the search box when the Source Sheet opens (no surprise on-screen keyboard)', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(gappedTranscript)

    await user.click(screen.getByRole('button', { name: '來源' }))
    await screen.findByText('第一句')

    expect(searchbox()).not.toHaveFocus()
    expect(screen.getByRole('dialog')).toHaveFocus()
  })
})

describe('JobDetailPage mini player (COMPLETED, narrow viewport)', () => {
  const citedHistory: QaTurn[] = [
    { question: '第三句在說什麼?', answer: '在說第三句', sourceTimestamps: [13], createdAt: '2026-01-01T00:00:00Z' },
  ]

  it('lets a Q&A citation seek playback without opening the Source Sheet', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(gappedTranscript, citedHistory)

    await user.click(await screen.findByRole('button', { name: '0:13' }))

    expect(renderedMediaElement().currentTime).toBe(13)
  })

  it('shows the current segment as a single line in the player, like lyrics', async () => {
    await renderCompletedJob(gappedTranscript)

    playTo(renderedMediaElement(), 13)

    expect(await within(screen.getByRole('region', { name: '播放器' })).findByText('第三句')).toBeInTheDocument()
  })

  it('plays and pauses from the player, reflecting the actual playback state', async () => {
    const user = userEvent.setup()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    await renderCompletedJob(gappedTranscript)
    const player = within(screen.getByRole('region', { name: '播放器' }))

    await user.click(player.getByRole('button', { name: '播放' }))
    expect(play).toHaveBeenCalled()

    // jsdom doesn't implement playback; emulate the browser flipping `paused` before `play` fires.
    const media = renderedMediaElement()
    Object.defineProperty(media, 'paused', { value: false, configurable: true })
    fireEvent.play(media)
    await user.click(player.getByRole('button', { name: '暫停' }))
    expect(pause).toHaveBeenCalled()
  })

  it('seeks when the user drags the progress bar, without the thumb snapping back while the seek is pending', async () => {
    await renderCompletedJob(gappedTranscript)
    const player = within(screen.getByRole('region', { name: '播放器' }))
    const slider = player.getByRole('slider', { name: '播放進度' })

    fireEvent.change(slider, { target: { value: '13' } })

    expect(renderedMediaElement().currentTime).toBe(13)
    // No timeupdate/seeked has arrived yet (a remote file may still be buffering).
    expect(slider).toHaveValue('13')
    expect(player.getByText('0:13 / 5:00')).toBeInTheDocument()
  })

  it('shows the playback position against the total length', async () => {
    await renderCompletedJob(gappedTranscript)

    playTo(renderedMediaElement(), 13)

    expect(within(screen.getByRole('region', { name: '播放器' })).getByText('0:13 / 5:00')).toBeInTheDocument()
  })

  it('keeps playing from the same position when the layout switches between desktop and narrow', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const layout = stubSwitchableLayout(true)
    await renderCompletedJob(gappedTranscript)
    await screen.findByText('第一句')
    const desktopMedia = renderedMediaElement()
    Object.defineProperty(desktopMedia, 'paused', { value: false, configurable: true })
    fireEvent.play(desktopMedia)
    playTo(desktopMedia, 13)

    layout.switchTo(false)

    const narrowMedia = renderedMediaElement()
    expect(narrowMedia).not.toBe(desktopMedia)
    expect(narrowMedia.currentTime).toBe(13)
    expect(play.mock.contexts).toContain(narrowMedia)
    expect(within(screen.getByRole('region', { name: '播放器' })).getByText('第三句')).toBeInTheDocument()
  })

  it('shows a small video picture in the player for a video job', async () => {
    await renderCompletedJob(gappedTranscript, [], { fileType: 'VIDEO' })

    const player = await screen.findByRole('region', { name: '播放器' })

    await waitFor(() => expect(player.querySelector('video')).not.toBeNull())
    expect(document.querySelectorAll('audio, video')).toHaveLength(1)
  })

  it('is not shown on desktop, where the player stays in the Source pane', async () => {
    await renderGappedTranscriptOnDesktop()

    expect(screen.queryByRole('region', { name: '播放器' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('audio, video')).toHaveLength(1)
  })
})

describe('JobDetailPage export menu', () => {
  // jsdom doesn't navigate on link clicks: capture what would have been downloaded.
  function captureDownloads() {
    const blobsByUrl = new Map<string, Blob>()
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      const url = `blob:export-${blobsByUrl.size}`
      blobsByUrl.set(url, blob as Blob)
      return url
    })
    const downloads: { fileName: string; blob: Blob | undefined }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ fileName: this.download, blob: blobsByUrl.get(this.href) })
    })
    return downloads
  }

  it('is offered in the workspace of a COMPLETED job', async () => {
    await renderCompletedJob()

    expect(screen.getByRole('button', { name: '匯出' })).toBeInTheDocument()
  })

  it('is not offered while the job is still processing', async () => {
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'SUMMARIZING' })
    renderJobDetail()

    await screen.findByText('處理中,完成後這裡會自動更新逐字稿與摘要...')
    expect(screen.queryByRole('button', { name: '匯出' })).not.toBeInTheDocument()
  })

  it('downloads the transcript as SRT subtitles named after the uploaded file', async () => {
    const user = userEvent.setup()
    const downloads = captureDownloads()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載字幕（SRT）' }))

    expect(downloads).toHaveLength(1)
    expect(downloads[0].fileName).toBe('interview.srt')
    expect(await downloads[0].blob?.text()).toContain('1\n00:00:05,000 --> 00:00:08,000\n第一句\n')
  })
})
