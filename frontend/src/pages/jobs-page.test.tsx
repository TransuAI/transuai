import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jobsApi } from '@/lib/api'
import type { Job } from '@/types/api'
import { JobsPage } from './jobs-page'

vi.mock('@/lib/api', () => ({
  jobsApi: {
    list: vi.fn(),
    remove: vi.fn(),
  },
}))

const mockJob: Job = {
  jobId: 'job-1',
  userId: 'user-1',
  fileName: 'interview.mp3',
  fileType: 'AUDIO',
  fileSizeBytes: 1024 * 1024,
  storagePath: 'uploads/interview.mp3',
  durationSeconds: 120,
  status: 'COMPLETED',
  errorReason: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  transcriptionLanguage: 'zh-TW',
}

describe('JobsPage', () => {
  it('renders jobs returned by the API', async () => {
    vi.mocked(jobsApi.list).mockResolvedValue({
      jobs: [mockJob],
      totalCount: 1,
      page: 0,
      pageSize: 10,
    })

    render(
      <MemoryRouter>
        <JobsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('interview.mp3')).toBeInTheDocument()
    expect(jobsApi.list).toHaveBeenCalledWith({ page: 1, pageSize: 10 })
  })

  it("shows a job's title and category, with its file name underneath", async () => {
    vi.mocked(jobsApi.list).mockResolvedValue({
      jobs: [{ ...mockJob, fileName: 'REC_0012.m4a', title: '產品週會：上傳失敗與轉錄重試', category: 'meeting' }, { ...mockJob, jobId: 'job-2' }],
      totalCount: 2,
      page: 0,
      pageSize: 10,
    })

    render(
      <MemoryRouter>
        <JobsPage />
      </MemoryRouter>,
    )

    const titled = (await screen.findByText('產品週會：上傳失敗與轉錄重試')).closest('a') as HTMLElement
    expect(within(titled).getByText('REC_0012.m4a')).toBeInTheDocument()
    expect(within(titled).getByText('會議')).toBeInTheDocument()
    // Without a title the file name is the heading, shown once.
    expect(screen.getAllByText('interview.mp3')).toHaveLength(1)
  })

  it('shows an empty state when there are no jobs', async () => {
    vi.mocked(jobsApi.list).mockResolvedValue({
      jobs: [],
      totalCount: 0,
      page: 0,
      pageSize: 10,
    })

    render(
      <MemoryRouter>
        <JobsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('還沒有任何 Job')).toBeInTheDocument()
  })
})

// Where the page is, for checking what the search and filter put in the address.
function LocationProbe() {
  const location = useLocation()
  return <output aria-label="網址">{location.search}</output>
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/jobs"
          element={
            <>
              <JobsPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

const listOf = (jobs: Job[], totalCount = jobs.length) => ({ jobs, totalCount, page: 1, pageSize: 10 })
const searchParamsShown = () => new URLSearchParams(screen.getByRole('status', { name: '網址' }).textContent ?? '')

describe('JobsPage search and category filter', () => {
  beforeEach(() => {
    vi.mocked(jobsApi.list).mockReset()
    vi.mocked(jobsApi.list).mockResolvedValue(listOf([mockJob]))
  })

  it('searches titles and file names once typing pauses, and keeps it in the address', async () => {
    const user = userEvent.setup()
    renderAt('/jobs')
    await screen.findByText('interview.mp3')

    await user.type(screen.getByRole('searchbox', { name: '搜尋標題或檔名' }), '週會')

    await waitFor(() => expect(jobsApi.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, query: '週會' }))
    // One search for the pause, not one per keystroke.
    expect(vi.mocked(jobsApi.list).mock.calls.filter(([params]) => params?.query)).toHaveLength(1)
    expect(searchParamsShown().get('q')).toBe('週會')
  })

  it('filters by category from the first page, and keeps it in the address', async () => {
    const user = userEvent.setup()
    vi.mocked(jobsApi.list).mockResolvedValue(listOf([mockJob], 25))
    renderAt('/jobs?page=2')
    await screen.findByText('interview.mp3')

    await user.selectOptions(screen.getByRole('combobox', { name: '類型' }), '課程')

    await waitFor(() => expect(jobsApi.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, category: 'lecture' }))
    expect(searchParamsShown().get('category')).toBe('lecture')
    expect(searchParamsShown().get('page')).toBeNull()
  })

  it('starts from what the address says, e.g. after a reload', async () => {
    vi.mocked(jobsApi.list).mockResolvedValue(listOf([mockJob], 25))
    renderAt('/jobs?q=%E9%80%B1%E6%9C%83&category=meeting&page=2')

    await screen.findByText('interview.mp3')
    expect(jobsApi.list).toHaveBeenCalledWith({ page: 2, pageSize: 10, query: '週會', category: 'meeting' })
    expect(screen.getByRole('searchbox', { name: '搜尋標題或檔名' })).toHaveValue('週會')
    expect(screen.getByRole('combobox', { name: '類型' })).toHaveValue('meeting')
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('pages through the jobs that match', async () => {
    const user = userEvent.setup()
    vi.mocked(jobsApi.list).mockResolvedValue(listOf([mockJob], 25))
    renderAt('/jobs?category=lecture')
    await screen.findByText('interview.mp3')

    await user.click(screen.getByRole('button', { name: '下一頁' }))

    await waitFor(() => expect(jobsApi.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 10, category: 'lecture' }))
    expect(searchParamsShown().get('page')).toBe('2')
  })

  it('says when nothing matches, and clears the search and filter', async () => {
    const user = userEvent.setup()
    vi.mocked(jobsApi.list).mockResolvedValue(listOf([]))
    renderAt('/jobs?q=xyz&category=podcast')

    expect(await screen.findByText('找不到符合的 Job')).toBeInTheDocument()
    expect(screen.queryByText('還沒有任何 Job')).not.toBeInTheDocument()

    vi.mocked(jobsApi.list).mockResolvedValue(listOf([mockJob]))
    await user.click(screen.getByRole('button', { name: '清除搜尋與篩選' }))

    await waitFor(() => expect(jobsApi.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 }))
    expect(screen.getByRole('searchbox', { name: '搜尋標題或檔名' })).toHaveValue('')
    expect(searchParamsShown().toString()).toBe('')
  })
})
