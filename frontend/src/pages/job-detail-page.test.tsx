import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chapterApi, jobsApi, qaApi, summaryApi, transcriptApi } from '@/lib/api'
import type { Chapter, Job, QaTurn, Summary, Transcript } from '@/types/api'

vi.mock('@/lib/api', () => ({
  jobsApi: {
    get: vi.fn(),
    getMediaUrl: vi
      .fn()
      .mockResolvedValue({ downloadUrl: 'https://media.example.com/uploads/interview.mp3', expiresAt: '2026-01-01T01:00:00Z' }),
  },
  transcriptApi: { get: vi.fn(), updateSegmentText: vi.fn() },
  summaryApi: { get: vi.fn(), regenerate: vi.fn() },
  chapterApi: { list: vi.fn() },
  qaApi: { ask: vi.fn(), history: vi.fn() },
}))

vi.mock('@/hooks/use-job-socket', () => ({
  useJobSocket: vi.fn(),
}))

let JobDetailPage: typeof import('./job-detail-page').JobDetailPage

afterEach(() => {
  vi.restoreAllMocks()
  // Only forgets recorded calls (implementations stay), so "was not called" holds per test.
  vi.clearAllMocks()
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
      <Toaster />
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
  revision: 0,
  segments: [{ id: 'seg-1', startTime: 5, endTime: 8, speakerLabel: 'A', text: '哈囉世界', originalText: '哈囉世界' }],
}

const mockSummary: Summary = { jobId: 'job-1', summaryText: '這是摘要內容', sourceRevision: 0, regenerationStatus: 'IDLE' }

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
// for the change and the workspace swaps layouts. Listeners get a MediaQueryListEvent-like
// `{ matches }`, which sonner's Toaster (watching prefers-color-scheme) destructures.
function stubSwitchableLayout(initiallyDesktop: boolean) {
  let isDesktop = initiallyDesktop
  const matches = (query: string) => query === '(min-width: 1024px)' && isDesktop
  const listeners = new Set<{ query: string; listener: (event: { matches: boolean }) => void }>()
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        get matches() {
          return matches(query)
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
          listeners.add({ query, listener }),
        removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
          listeners.forEach((entry) => entry.listener === listener && listeners.delete(entry)),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
  return {
    switchTo(desktop: boolean) {
      isDesktop = desktop
      act(() => listeners.forEach(({ query, listener }) => listener({ matches: matches(query) })))
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
  revision: 0,
  segments: [
    { id: 'seg-2', startTime: 5, endTime: 8, speakerLabel: null, text: '第一句', originalText: '第一句' },
    { id: 'seg-3', startTime: 8, endTime: 10, speakerLabel: null, text: '第二句', originalText: '第二句' },
    { id: 'seg-4', startTime: 12, endTime: 15, speakerLabel: null, text: '第三句', originalText: '第三句' },
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
  revision: 0,
  segments: [
    { id: 'seg-5', startTime: 0, endTime: 4, speakerLabel: null, text: '今天先討論預算', originalText: '今天先討論預算' },
    { id: 'seg-6', startTime: 4, endTime: 8, speakerLabel: null, text: '下一季的預算要再確認一次預算上限', originalText: '下一季的預算要再確認一次預算上限' },
    { id: 'seg-7', startTime: 8, endTime: 12, speakerLabel: null, text: '文件放在 API 規格裡', originalText: '文件放在 API 規格裡' },
    { id: 'seg-8', startTime: 12, endTime: 16, speakerLabel: null, text: 'api 的版本下週定案', originalText: 'api 的版本下週定案' },
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

  it.each([
    ['下載字幕（VTT）', 'interview.vtt', 'WEBVTT\n\n00:00:05.000 --> 00:00:08.000\n第一句\n'],
    ['下載逐字稿（TXT，純文字）', 'interview.txt', '第一句\n第二句\n第三句\n'],
    ['下載逐字稿（TXT，含時間戳）', 'interview-含時間戳.txt', '[00:05] 第一句\n[00:08] 第二句\n'],
  ])('%s downloads %s', async (item, fileName, expectedContent) => {
    const user = userEvent.setup()
    const downloads = captureDownloads()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: item }))

    expect(downloads.map((download) => download.fileName)).toEqual([fileName])
    expect(await downloads[0].blob?.text()).toContain(expectedContent)
  })

  it('copies the transcript as plain text and confirms it', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '複製逐字稿' }))

    expect(await navigator.clipboard.readText()).toBe('第一句\n第二句\n第三句\n')
    expect(await screen.findByText('已複製逐字稿')).toBeInTheDocument()
  })

  it('copies the summary and confirms it', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '複製摘要' }))

    expect(await navigator.clipboard.readText()).toBe('這是摘要內容')
    expect(await screen.findByText('已複製摘要')).toBeInTheDocument()
  })

  it('tells the user when copying fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '複製摘要' }))

    expect(await screen.findByText('複製失敗')).toBeInTheDocument()
  })

  it('downloads a Markdown report, leaving the Q&A history out unless the user opts in', async () => {
    const user = userEvent.setup()
    const downloads = captureDownloads()
    await renderGappedTranscriptOnDesktop([
      { question: '第三句在說什麼?', answer: '在說第三句', sourceTimestamps: [13], createdAt: '2026-01-01T00:00:00Z' },
    ])

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載報告（Markdown）' }))

    expect(downloads[0].fileName).toBe('interview-報告.md')
    const report = await downloads[0].blob?.text()
    expect(report).toContain('## 摘要\n\n這是摘要內容\n')
    expect(report).toContain('## 逐字稿\n\n[00:05] 第一句\n')
    expect(report).not.toContain('## 問答紀錄')

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: '報告包含問答紀錄' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載報告（Markdown）' }))

    expect(await downloads[1].blob?.text()).toContain('## 問答紀錄\n\n### 第三句在說什麼?\n\n在說第三句\n\n引用：[00:13]\n')
  })

  it('downloads the original media file through an attachment URL from the Gateway', async () => {
    const user = userEvent.setup()
    const opened: { href: string; download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      opened.push({ href: this.href, download: this.download })
    })
    await renderGappedTranscriptOnDesktop()
    vi.mocked(jobsApi.getMediaUrl).mockResolvedValueOnce({
      downloadUrl: 'https://media.example.com/uploads/interview.mp3?response-content-disposition=attachment',
      expiresAt: '2026-01-01T01:00:00Z',
    })

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載原始檔' }))

    expect(jobsApi.getMediaUrl).toHaveBeenLastCalledWith('job-1', { download: true })
    await waitFor(() =>
      expect(opened).toEqual([
        { href: 'https://media.example.com/uploads/interview.mp3?response-content-disposition=attachment', download: '' },
      ]),
    )
  })
})

describe('JobDetailPage segment editing (COMPLETED, desktop layout)', () => {
  function editButtonFor(text: string) {
    const row = screen.getByText(text).closest('[data-segment-index]')
    if (!(row instanceof HTMLElement)) throw new Error(`no segment row for ${text}`)
    return within(row).getByRole('button', { name: '編輯片段' })
  }

  it('edits a segment in place and saves it on Enter', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { id: 'seg-3', startTime: 8, endTime: 10, speakerLabel: null, text: '第二句改好了', originalText: '第二句' },
      revision: 1,
    })
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    expect(editor).toHaveValue('第二句')
    await user.clear(editor)
    await user.type(editor, '第二句改好了{Enter}')

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-3', '第二句改好了')
    expect(await screen.findByText('第二句改好了')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
  })

  it('cancels editing on Escape without saving', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '亂打{Escape}')

    expect(transcriptApi.updateSegmentText).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
    expect(screen.getByText('第二句')).toBeInTheDocument()
  })

  it('keeps what the user typed and says so when saving fails', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockRejectedValue(new Error('network'))
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    await user.clear(editor)
    await user.type(editor, '沒存到{Enter}')

    expect(await screen.findByText('儲存失敗')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '編輯片段文字' })).toHaveValue('沒存到')
  })

  it('shows that it is saving and blocks further input meanwhile', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockReturnValue(new Promise(() => {}))
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '改{Enter}')

    expect(screen.getByRole('textbox', { name: '編輯片段文字' })).toBeDisabled()
    expect(screen.getByText('儲存中…')).toBeInTheDocument()
  })

  it('pauses auto-follow while editing, without pausing playback', async () => {
    const user = userEvent.setup()
    const media = await renderGappedTranscriptOnDesktop()
    playTo(media, 9)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')

    await user.click(editButtonFor('第一句'))

    expect(screen.getByRole('button', { name: '回到播放位置' })).toBeInTheDocument()
    expect(pause).not.toHaveBeenCalled()
  })

  it('cancels an edit on Escape inside the Source Sheet without closing the Sheet (narrow viewport)', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(gappedTranscript)
    await user.click(screen.getByRole('button', { name: '來源' }))
    await screen.findByText('第二句')

    await user.click(editButtonFor('第二句'))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('第二句')).toBeInTheDocument()
  })

  it('does not close the editor of another segment when an earlier save finishes', async () => {
    const user = userEvent.setup()
    let finishFirstSave: () => void = () => {}
    vi.mocked(transcriptApi.updateSegmentText).mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirstSave = () =>
          resolve({
            segment: { id: 'seg-2', startTime: 5, endTime: 8, speakerLabel: null, text: '第一句改', originalText: '第一句' },
            revision: 1,
          })
      }),
    )
    await renderGappedTranscriptOnDesktop()
    await user.click(editButtonFor('第一句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '改{Enter}')

    await user.click(editButtonFor('第三句'))
    finishFirstSave()

    expect(await screen.findByText('第一句改')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '編輯片段文字' })).toHaveValue('第三句')
  })

  it('does not send anything when Enter is pressed without a change', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '{Enter}')

    expect(transcriptApi.updateSegmentText).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
  })

  it("gives keyboard focus back to the segment's edit button when the editor closes", async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.keyboard('{Escape}')

    expect(editButtonFor('第二句')).toHaveFocus()
  })

  it('keeps the search counter within the matches that remain after an edit', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { id: 'seg-4', startTime: 12, endTime: 15, speakerLabel: null, text: '最後一段', originalText: '第三句' },
      revision: 1,
    })
    await renderGappedTranscriptOnDesktop()
    await user.type(searchbox(), '句')
    await user.click(screen.getByRole('button', { name: '上一個符合結果' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()

    // The search highlights split 「第三句」 into several elements, so pick the third segment's button.
    await user.click(screen.getAllByRole('button', { name: '編輯片段' })[2])
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    await user.clear(editor)
    await user.type(editor, '最後一段{Enter}')

    expect(await screen.findByText('2 / 2')).toBeInTheDocument()
  })
})

describe('JobDetailPage edited and cleared segments (COMPLETED, desktop layout)', () => {
  const editedTranscript: Transcript = {
    ...gappedTranscript,
    revision: 2,
    segments: [
      { id: 'seg-a', startTime: 5, endTime: 8, speakerLabel: null, text: '強風豪雨', originalText: '強風好雨' },
      { id: 'seg-b', startTime: 8, endTime: 10, speakerLabel: null, text: '', originalText: '請不吝點讚訂閱' },
      { id: 'seg-c', startTime: 12, endTime: 15, speakerLabel: null, text: '沒改過', originalText: '沒改過' },
    ],
  }

  async function renderEdited() {
    stubDesktopLayout()
    await renderCompletedJob(editedTranscript)
    await screen.findByText('強風豪雨')
  }

  function row(index: number) {
    const element = document.querySelector(`[data-segment-index="${index}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no segment row ${index}`)
    return within(element)
  }

  it('marks a segment whose text differs from the original text, and only that one', async () => {
    await renderEdited()

    expect(row(0).getByText('已編輯')).toBeInTheDocument()
    expect(row(2).queryByText('已編輯')).not.toBeInTheDocument()
    expect(row(2).queryByRole('button', { name: '還原成原始文字' })).not.toBeInTheDocument()
  })

  it('restores an edited segment to its original text', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...editedTranscript.segments[0], text: '強風好雨' },
      revision: 3,
    })
    await renderEdited()

    await user.click(row(0).getByRole('button', { name: '還原成原始文字' }))

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-a', '強風好雨')
    expect(await screen.findByText('強風好雨')).toBeInTheDocument()
    expect(row(0).queryByText('已編輯')).not.toBeInTheDocument()
  })

  it('shows a cleared segment as a faint row that can be restored', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...editedTranscript.segments[1], text: '請不吝點讚訂閱' },
      revision: 3,
    })
    await renderEdited()

    expect(row(1).getByText('已清空')).toBeInTheDocument()
    expect(screen.queryByText('請不吝點讚訂閱')).not.toBeInTheDocument()

    await user.click(row(1).getByRole('button', { name: '還原：請不吝點讚訂閱' }))

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-b', '請不吝點讚訂閱')
    expect(await screen.findByText('請不吝點讚訂閱')).toBeInTheDocument()
  })

  it('does not find a cleared segment when searching', async () => {
    const user = userEvent.setup()
    await renderEdited()

    await user.type(searchbox(), '點讚')

    expect(screen.getByText('沒有符合的結果')).toBeInTheDocument()
  })

  it('clears a segment when its text is saved empty', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...editedTranscript.segments[2], text: '' },
      revision: 3,
    })
    await renderEdited()

    await user.click(row(2).getByRole('button', { name: '編輯片段' }))
    await user.clear(screen.getByRole('textbox', { name: '編輯片段文字' }))
    await user.keyboard('{Enter}')

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-c', '')
    expect(await row(2).findByText('已清空')).toBeInTheDocument()
  })

  it('still highlights a cleared segment when playback is inside it', async () => {
    await renderEdited()

    playTo(renderedMediaElement(), 9)

    expect(currentSegmentText()).toContain('已清空')
  })

  it('gives focus back to the segment and blocks a second click while restoring', async () => {
    const user = userEvent.setup()
    let finishRestore: () => void = () => {}
    vi.mocked(transcriptApi.updateSegmentText).mockReturnValue(
      new Promise((resolve) => {
        finishRestore = () => resolve({ segment: { ...editedTranscript.segments[0], text: '強風好雨' }, revision: 3 })
      }),
    )
    await renderEdited()

    const restore = row(0).getByRole('button', { name: '還原成原始文字' })
    await user.click(restore)
    expect(restore).toBeDisabled()
    finishRestore()

    await screen.findByText('強風好雨')
    expect(row(0).getByRole('button', { name: '編輯片段' })).toHaveFocus()
    expect(transcriptApi.updateSegmentText).toHaveBeenCalledTimes(1)
  })

  it('offers no restore for a segment whose original text was empty to begin with', async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...editedTranscript,
      segments: [{ id: 'seg-z', startTime: 5, endTime: 8, speakerLabel: null, text: '', originalText: '' }],
    })
    await screen.findByText('已清空')

    expect(row(0).queryByRole('button', { name: /^還原/ })).not.toBeInTheDocument()
  })
})

describe('JobDetailPage 過時 summary and chapters (COMPLETED, desktop layout)', () => {
  const staleNotice = '逐字稿已修改，摘要與章節可能過時'

  async function editFirstSegment() {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...gappedTranscript.segments[0], text: '第一句改' },
      revision: 1,
    })
    const row = screen.getByText('第一句').closest('[data-segment-index]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: '編輯片段' }))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '改{Enter}')
    await screen.findByText('第一句改')
    return user
  }

  it('shows no notice while the summary matches the transcript', async () => {
    await renderGappedTranscriptOnDesktop()

    expect(screen.queryByText(staleNotice)).not.toBeInTheDocument()
  })

  it('flags the summary and chapters as 過時 as soon as an edit is saved', async () => {
    await renderGappedTranscriptOnDesktop()

    await editFirstSegment()

    expect(screen.getByText(staleNotice)).toBeInTheDocument()
  })

  it('carries the 過時 note into the Markdown report', async () => {
    const downloads: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      downloads.push(blob as Blob)
      return 'blob:report'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await renderGappedTranscriptOnDesktop()
    const user = await editFirstSegment()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載報告（Markdown）' }))

    expect(await downloads[0].text()).toContain('> 逐字稿在摘要產生後有修改，摘要與章節可能過時')
  })
})

describe('JobDetailPage regenerating the summary and chapters (COMPLETED, desktop layout)', () => {
  const staleTranscript: Transcript = { ...gappedTranscript, revision: 1 }
  const fresh: Summary = { jobId: 'job-1', summaryText: '重新產生的摘要', sourceRevision: 1, regenerationStatus: 'IDLE' }
  const running: Summary = { ...mockSummary, regenerationStatus: 'RUNNING' }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function renderStale(summary: Summary = mockSummary) {
    stubDesktopLayout()
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'COMPLETED' })
    vi.mocked(transcriptApi.get).mockResolvedValue(staleTranscript)
    vi.mocked(summaryApi.get).mockResolvedValue(summary)
    vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)
    vi.mocked(qaApi.history).mockResolvedValue([])
    renderJobDetail()
    await screen.findByText('第一句')
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  }

  it('offers no regeneration while the summary is up to date', async () => {
    stubDesktopLayout()
    await renderCompletedJob(gappedTranscript)

    expect(screen.queryByRole('button', { name: '重新產生摘要與章節' })).not.toBeInTheDocument()
  })

  it('regenerates in the background and swaps in the new summary and chapters when done', async () => {
    const user = await renderStale()
    vi.mocked(summaryApi.regenerate).mockResolvedValue(running)
    vi.mocked(summaryApi.get).mockResolvedValue(fresh)
    vi.mocked(chapterApi.list).mockResolvedValue([{ id: 'ch-9', jobId: 'job-1', title: '新章節', startTime: 5, sequenceNo: 0 }])

    await user.click(await screen.findByRole('button', { name: '重新產生摘要與章節' }))

    expect(summaryApi.regenerate).toHaveBeenCalledWith('job-1')
    expect(screen.getByText('重新產生中…')).toBeInTheDocument()
    expect(screen.getByText('這是摘要內容')).toBeInTheDocument() // the old content stays meanwhile

    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('重新產生的摘要')).toBeInTheDocument()
    expect(screen.getByText('新章節')).toBeInTheDocument()
    expect(screen.queryByText('逐字稿已修改，摘要與章節可能過時')).not.toBeInTheDocument()
  })

  it('keeps the old content and says so when the regeneration fails', async () => {
    const user = await renderStale()
    vi.mocked(summaryApi.regenerate).mockResolvedValue(running)
    vi.mocked(summaryApi.get).mockResolvedValue({ ...mockSummary, regenerationStatus: 'FAILED' })

    await user.click(await screen.findByRole('button', { name: '重新產生摘要與章節' }))
    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('重新產生失敗')).toBeInTheDocument()
    expect(screen.getByText('這是摘要內容')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新產生摘要與章節' })).toBeEnabled()
  })

  it('keeps waiting for a regeneration that was already running when the page opened', async () => {
    await renderStale(running)
    vi.mocked(summaryApi.get).mockResolvedValue(fresh)

    expect(await screen.findByText('重新產生中…')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('重新產生的摘要')).toBeInTheDocument()
  })

  it('sends one request even when the button is clicked twice before it answers', async () => {
    const user = await renderStale()
    vi.mocked(summaryApi.regenerate).mockReturnValue(new Promise(() => {}))

    const button = await screen.findByRole('button', { name: '重新產生摘要與章節' })
    await user.click(button)
    await user.click(button)

    expect(summaryApi.regenerate).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
  })

  it('keeps the old chapters if reloading them after a regeneration fails', async () => {
    const user = await renderStale()
    vi.mocked(summaryApi.regenerate).mockResolvedValue(running)
    vi.mocked(summaryApi.get).mockResolvedValue(fresh)
    vi.mocked(chapterApi.list).mockRejectedValue(new Error('network'))

    await user.click(await screen.findByRole('button', { name: '重新產生摘要與章節' }))
    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('重新產生的摘要')).toBeInTheDocument()
    expect(screen.getByText('開場')).toBeInTheDocument()
  })
})
