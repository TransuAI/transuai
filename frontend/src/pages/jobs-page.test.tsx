import { render, screen } from '@testing-library/react'
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
