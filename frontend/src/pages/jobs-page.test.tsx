import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
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
    expect(jobsApi.list).toHaveBeenCalledWith({ page: 0, pageSize: 10 })
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
