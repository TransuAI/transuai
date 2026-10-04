import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decisionsApi } from '@/lib/api'
import type { Decision, DecisionTimeline } from '@/types/api'
import { DecisionsPage } from './decisions-page'

vi.mock('@/lib/api', () => ({ decisionsApi: { timeline: vi.fn() } }))

const september = { jobId: 'job-a', title: '九月週會', fileName: 'sep.mp3', category: 'meeting' as const, createdAt: '2026-09-01T04:00:00Z' }
const october = { jobId: 'job-b', title: null, fileName: 'oct.mp3', category: 'interview' as const, createdAt: '2026-10-01T04:00:00Z' }

const decision = (overrides: Partial<Decision>): Decision => ({
  id: 'd1', jobId: 'job-a', statement: '資料庫用 MySQL', rationale: '團隊熟', alternatives: ['PostgreSQL'], proposedBy: 'S1',
  tentative: false, startTime: 8, evidenceText: '那就用 MySQL', source: 'ai', edited: false, supersedesId: null,
  createdAt: '2026-09-01T05:00:00Z', ...overrides,
})

const timeline: DecisionTimeline = {
  items: [
    { job: october, decision: decision({ id: 'd3', jobId: 'job-b', statement: '資料庫改用 PostgreSQL', tentative: true, startTime: 30, evidenceText: '改用 PostgreSQL 吧' }) },
    { job: september, decision: decision({}) },
    { job: september, decision: decision({ id: 'd2', statement: '週會改到週三', rationale: '', alternatives: [], startTime: null, evidenceText: null, source: 'user' }) },
  ],
}

function Location() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

function renderPage(path = '/decisions') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/decisions" element={<DecisionsPage />} />
        <Route path="/jobs/:jobId" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(decisionsApi.timeline).mockReset()
  vi.mocked(decisionsApi.timeline).mockResolvedValue(timeline)
})

describe('DecisionsPage', () => {
  it("shows every meeting's decisions on a timeline, newest meeting first", async () => {
    renderPage()

    const meetings = await screen.findAllByRole('region')
    expect(meetings.map((m) => within(m).getByRole('heading').textContent)).toEqual(['oct.mp3', '九月週會'])
    expect(meetings[0]).toHaveTextContent('2026/10/1')
    expect(meetings[0]).toHaveTextContent('訪談')
    const [mysql, wednesday] = within(meetings[1]).getAllByRole('listitem')
    expect(mysql).toHaveTextContent('資料庫用 MySQL')
    expect(mysql).toHaveTextContent('理由：團隊熟')
    expect(mysql).toHaveTextContent('沒選：PostgreSQL')
    expect(mysql).toHaveTextContent('那就用 MySQL')
    expect(wednesday).toHaveTextContent('自己新增')
    expect(within(meetings[0]).getByText('暫定')).toBeInTheDocument()
    expect(decisionsApi.timeline).toHaveBeenCalledWith({})
  })

  it('opens a decision where it was made in its job', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('link', { name: '0:08' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/jobs/job-a?t=8&decision=d1')
  })

  it('links each meeting to its job', async () => {
    renderPage()

    expect(await screen.findByRole('link', { name: '九月週會' })).toHaveAttribute('href', '/jobs/job-a')
  })

  it('searches once typing pauses, showing the best matches first with their meeting', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByRole('region')
    vi.mocked(decisionsApi.timeline).mockResolvedValue({ items: [timeline.items[1], timeline.items[0]] })

    await user.type(screen.getByRole('searchbox', { name: '搜尋決策' }), '資料庫')

    await waitFor(() => expect(decisionsApi.timeline).toHaveBeenLastCalledWith({ q: '資料庫' }))
    const results = await screen.findByRole('list', { name: '搜尋結果' })
    const items = within(results).getAllByRole('listitem')
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual(['資料庫用 MySQL', '資料庫改用 PostgreSQL'])
    expect(items[0]).toHaveTextContent('九月週會')
  })

  it('filters by category and by job, keeping them in the address', async () => {
    const user = userEvent.setup()
    renderPage('/decisions?category=meeting')
    await screen.findAllByRole('region')
    expect(decisionsApi.timeline).toHaveBeenCalledWith({ category: 'meeting' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Job' }), '九月週會')

    await waitFor(() => expect(decisionsApi.timeline).toHaveBeenLastCalledWith({ category: 'meeting', jobId: 'job-a' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '類型' }), '全部類型')
    await waitFor(() => expect(decisionsApi.timeline).toHaveBeenLastCalledWith({ jobId: 'job-a' }))
  })

  it('says how to get decisions when there are none yet', async () => {
    vi.mocked(decisionsApi.timeline).mockResolvedValue({ items: [] })
    renderPage()

    expect(await screen.findByText(/還沒有決策/)).toBeInTheDocument()
  })

  it('downloads what is shown as Markdown', async () => {
    const user = userEvent.setup()
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:decisions'
    })
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    renderPage('/decisions?category=meeting')
    await screen.findAllByRole('region')

    await user.click(screen.getByRole('button', { name: '下載 Markdown' }))

    expect(names).toEqual(['決策.md'])
    const markdown = await blobs[0].text()
    expect(markdown).toContain('# 決策\n\n- 類型：會議\n')
    expect(markdown).toContain('## 2026/10/1 oct.mp3\n\n### 資料庫改用 PostgreSQL（暫定）')
    expect(markdown).toContain('## 2026/9/1 九月週會\n\n### 資料庫用 MySQL\n\n- 理由：團隊熟\n- 沒選：PostgreSQL\n- 時間：[00:08] 「那就用 MySQL」')
  })
})
