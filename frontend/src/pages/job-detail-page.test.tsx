import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chapterApi, jobsApi, qaApi, summaryApi, transcriptApi } from '@/lib/api'
import type { Chapter, Job, Summary, Transcript } from '@/types/api'

vi.mock('@/lib/api', () => ({
  jobsApi: { get: vi.fn() },
  transcriptApi: { get: vi.fn() },
  summaryApi: { get: vi.fn() },
  chapterApi: { list: vi.fn() },
  qaApi: { ask: vi.fn() },
}))

vi.mock('@/hooks/use-job-socket', () => ({
  useJobSocket: vi.fn(),
}))

let JobDetailPage: typeof import('./job-detail-page').JobDetailPage

beforeAll(async () => {
  vi.stubEnv('VITE_MEDIA_BASE_URL', 'https://media.example.com')
  ;({ JobDetailPage } = await import('./job-detail-page'))
})

afterAll(() => {
  vi.unstubAllEnvs()
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

  it('renders the Source, Chat, and Studio panes for a COMPLETED job', async () => {
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'COMPLETED' })
    vi.mocked(transcriptApi.get).mockResolvedValue(mockTranscript)
    vi.mocked(summaryApi.get).mockResolvedValue(mockSummary)
    vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)

    renderJobDetail()

    expect(await screen.findByText('哈囉世界', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('問答')).toBeInTheDocument()
    expect(screen.getByText('Studio')).toBeInTheDocument()
    expect(screen.getByText('這是摘要內容')).toBeInTheDocument()
    expect(screen.getByText('開場')).toBeInTheDocument()
  })
})

describe('JobDetailPage Chat pane (COMPLETED)', () => {
  async function renderCompletedJob() {
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'COMPLETED' })
    vi.mocked(transcriptApi.get).mockResolvedValue(mockTranscript)
    vi.mocked(summaryApi.get).mockResolvedValue(mockSummary)
    vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)

    const view = renderJobDetail()
    await screen.findByText('問答')
    return view
  }

  it('asks a question, appends it to history, and seeks the media player from a citation timestamp', async () => {
    const user = userEvent.setup()
    vi.mocked(qaApi.ask).mockResolvedValue({ answer: '答案內容', sourceTimestamps: [42] })

    await renderCompletedJob()

    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), '這段在說什麼?')
    await user.click(screen.getByRole('button', { name: '問' }))

    expect(qaApi.ask).toHaveBeenCalledWith('job-1', '這段在說什麼?')
    expect(await screen.findByText('這段在說什麼?')).toBeInTheDocument()
    expect(screen.getByText('答案內容')).toBeInTheDocument()

    const citation = screen.getByRole('button', { name: '0:42' })
    await user.click(citation)

    const audio = document.querySelector('audio')
    expect(audio).not.toBeNull()
    expect(audio?.currentTime).toBe(42)
  })

  it('seeks the media player when a transcript segment is clicked', async () => {
    const user = userEvent.setup()
    await renderCompletedJob()

    await user.click(await screen.findByRole('button', { name: '0:05' }))

    const audio = document.querySelector('audio')
    expect(audio?.currentTime).toBe(5)
  })

  it('seeks the media player when a chapter is clicked', async () => {
    const user = userEvent.setup()
    await renderCompletedJob()

    await user.click(await screen.findByRole('button', { name: '0:12開場' }))

    const audio = document.querySelector('audio')
    expect(audio?.currentTime).toBe(12)
  })
})
