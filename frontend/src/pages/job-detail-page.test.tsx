import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { chapterApi, jobsApi, qaApi, summaryApi, transcriptApi } from '@/lib/api'
import type { Chapter, Job, Summary, Transcript } from '@/types/api'

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

async function renderCompletedJob() {
  vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'COMPLETED' })
  vi.mocked(transcriptApi.get).mockResolvedValue(mockTranscript)
  vi.mocked(summaryApi.get).mockResolvedValue(mockSummary)
  vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)
  vi.mocked(qaApi.history).mockResolvedValue([])

  const view = renderJobDetail()
  await screen.findByText('問答')
  return view
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

// The Source/Studio Sheets are modal on narrow viewports (matching the Sidebar's own
// mobile drawer), so the media player they contain isn't necessarily mounted at the same
// time as the Chat pane is interactive. These tests force the desktop layout, where
// Source/Chat/Studio render inline simultaneously with no modal blocking, to exercise the
// carried-over ask -> history -> citation-seek and segment/chapter-seek behavior.
describe('JobDetailPage Chat pane (COMPLETED, desktop layout)', () => {
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
