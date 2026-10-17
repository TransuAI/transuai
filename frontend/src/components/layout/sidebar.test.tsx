import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '@/context/auth-context'
import { AppShell } from './app-shell'

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/jobs" element={<div>Jobs page content</div>} />
            <Route path="/jobs/:jobId" element={<div>Job detail content</div>} />
            <Route path="/upload" element={<div>Upload page content</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('Sidebar route-driven collapse', () => {
  it('is expanded by default on a non-Job-Detail route', () => {
    renderShell('/jobs')

    expect(screen.getByText('我的檔案')).toBeInTheDocument()
    expect(screen.getByText('上傳')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收合側邊欄' })).toBeInTheDocument()
  })

  it('auto-collapses to an icon rail on a Job Detail route', () => {
    renderShell('/jobs/job-1')

    expect(screen.queryByText('我的檔案')).not.toBeInTheDocument()
    expect(screen.queryByText('上傳')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展開側邊欄' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '上傳' })).toBeInTheDocument()
  })

  it('lets the user manually expand the collapsed rail on a Job Detail route', async () => {
    const user = userEvent.setup()
    renderShell('/jobs/job-1')

    await user.click(screen.getByRole('button', { name: '展開側邊欄' }))

    expect(screen.getByText('我的檔案')).toBeInTheDocument()
    expect(screen.getByText('上傳')).toBeInTheDocument()
  })

  it('re-derives the collapse state from the route default on the next navigation, not the manual override', async () => {
    const user = userEvent.setup()
    renderShell('/jobs')

    await user.click(screen.getByRole('button', { name: '收合側邊欄' }))
    expect(screen.queryByText('上傳')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '上傳' }))

    expect(await screen.findByText('Upload page content')).toBeInTheDocument()
    expect(screen.getByText('上傳')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收合側邊欄' })).toBeInTheDocument()
  })
})
