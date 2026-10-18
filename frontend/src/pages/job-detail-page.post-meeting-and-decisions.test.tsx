import { renderJobDetail, baseJob, mockSummary, mockChapters, renderCompletedJob, openStudioTool, stubDesktopLayout, renderedMediaElement, currentSegmentText, multiSpeakerTranscript, captureDownloads } from '@/test/job-detail-page-support'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chapterApi, jobsApi, postMeetingApi, qaApi, summaryApi, transcriptApi, usageApi, decisionsApi } from '@/lib/api'
import type { Decision, DecisionExtraction, PostMeetingRun } from '@/types/api'

describe('JobDetailPage post-meeting processing (會後處理)', () => {
  const run = (overrides: Partial<PostMeetingRun> = {}): PostMeetingRun => ({
    id: 'run-1',
    status: 'COMPLETED',
    progress: null,
    failureReason: null,
    modelProvider: 'openai',
    model: 'gpt-5',
    requestedAt: '2026-11-11T10:00:00Z',
    finishedAt: '2026-11-11T10:00:40Z',
    proposals: [],
    ...overrides,
  })
  const nextMeeting = {
    id: 'p-1',
    service: 'google_calendar',
    tool: 'calendar_create_event',
    kind: 'calendar_event',
    arguments: { summary: '搬家確認會議', start: '2026-11-18T14:00:00+08:00', end: '2026-11-18T15:00:00+08:00', description: '確認搬家分工' },
    status: 'PROPOSED' as const,
    resultUrl: null,
    failureReason: null,
    previouslyCreated: false,
  }
  const movers = {
    ...nextMeeting,
    id: 'p-2',
    arguments: { summary: '搬家公司看場地', start: '2026-11-13T10:00:00+08:00', end: '2026-11-13T11:00:00+08:00' },
  }
  // The form shows times in the browser's own zone, as <input type="datetime-local"> values.
  const localInput = (iso: string) => {
    const d = new Date(iso)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const proposalForm = (title: string) => within(card()).getByRole('group', { name: title })
  const card = () => screen.getByRole('region', { name: '會後處理' })

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function renderCard() {
    stubDesktopLayout()
    await renderCompletedJob()
    await openStudioTool('會後處理')
    await screen.findByRole('region', { name: '會後處理' })
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  }

  it('says why it cannot run, with the button turned off', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: false,
      unavailableReason: '請先到設定頁連結 Google 帳號，會後處理才能查詢你的行事曆',
      hints: [], earlierRuns: [],
      latestRun: null,
    })
    await renderCard()

    expect(await within(card()).findByText('請先到設定頁連結 Google 帳號，會後處理才能查詢你的行事曆')).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: '開始會後處理' })).toBeDisabled()
  })

  it('starts with the browser time zone, shows what it is doing, and lists its proposals when done', async () => {
    const user = await renderCard()
    vi.mocked(postMeetingApi.start).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ status: 'RUNNING', progress: '排隊中…', finishedAt: null }),
    })

    await user.click(await within(card()).findByRole('button', { name: '開始會後處理' }))

    expect(postMeetingApi.start).toHaveBeenCalledWith('job-1', Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(await within(card()).findByText('排隊中…')).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: '開始會後處理' })).toBeDisabled()

    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ status: 'RUNNING', progress: '正在查詢你的行事曆…', finishedAt: null }),
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(await within(card()).findByText('正在查詢你的行事曆…')).toBeInTheDocument()

    vi.mocked(postMeetingApi.get).mockResolvedValue({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: run({ proposals: [nextMeeting] }) })
    vi.mocked(usageApi.getJobUsage).mockClear()
    await vi.advanceTimersByTimeAsync(3000)

    const proposal = await within(card()).findByRole('group', { name: '行事曆活動：搬家確認會議' })
    expect(within(proposal).getByLabelText('標題')).toHaveValue('搬家確認會議')
    expect(within(proposal).getByLabelText('描述')).toHaveValue('確認搬家分工')
    expect(within(proposal).getByLabelText('開始')).toHaveValue(localInput('2026-11-18T14:00:00+08:00'))
    expect(within(proposal).getByLabelText('結束')).toHaveValue(localInput('2026-11-18T15:00:00+08:00'))
    expect(within(card()).queryByText('正在查詢你的行事曆…')).not.toBeInTheDocument()
    expect(usageApi.getJobUsage).toHaveBeenCalled() // the run used the model
  })

  it('does not go back to an older state when an earlier poll answers late', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ status: 'RUNNING', progress: '正在閱讀摘要…', finishedAt: null }),
    })
    await renderCard()
    await within(card()).findByText('正在閱讀摘要…')
    let answerOldPoll: (value: Awaited<ReturnType<typeof postMeetingApi.get>>) => void = () => {}
    vi.mocked(postMeetingApi.get).mockReturnValueOnce(new Promise((resolve) => (answerOldPoll = resolve)))
    await vi.advanceTimersByTimeAsync(3000) // a slow poll goes out…
    vi.mocked(postMeetingApi.get).mockResolvedValue({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: run({ proposals: [nextMeeting] }) })
    await vi.advanceTimersByTimeAsync(3000) // …a later one says it's done

    expect(await within(card()).findByDisplayValue('搬家確認會議')).toBeInTheDocument()
    await act(async () =>
      answerOldPoll({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: run({ status: 'RUNNING', progress: '正在閱讀摘要…', finishedAt: null }) }),
    )

    expect(within(card()).getByDisplayValue('搬家確認會議')).toBeInTheDocument()
    expect(within(card()).queryByText('正在閱讀摘要…')).not.toBeInTheDocument()
  })

  it('carries out the checked proposals with the edited values and shows each result', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ proposals: [nextMeeting, movers] }),
    })
    const user = await renderCard()
    const meeting = await within(card()).findByRole('group', { name: '行事曆活動：搬家確認會議' })
    const title = within(meeting).getByLabelText('標題')
    await user.clear(title)
    await user.type(title, '搬家確認會議（改到 3 點）')
    fireEvent.change(within(meeting).getByLabelText('開始'), { target: { value: '2026-11-18T15:00' } })
    fireEvent.change(within(meeting).getByLabelText('結束'), { target: { value: '2026-11-18T16:00' } })
    await user.click(within(proposalForm('行事曆活動：搬家公司看場地')).getByRole('checkbox', { name: '執行這一項' }))
    vi.mocked(postMeetingApi.execute).mockResolvedValue(
      run({
        proposals: [
          { ...nextMeeting, status: 'DONE', resultUrl: 'https://www.google.com/calendar/event?eid=evt-1' },
          movers,
        ],
      }),
    )

    await user.click(within(card()).getByRole('button', { name: '執行勾選的項目' }))

    const [[jobId, runId, items]] = vi.mocked(postMeetingApi.execute).mock.calls
    expect([jobId, runId]).toEqual(['job-1', 'run-1'])
    expect(items).toHaveLength(1) // the unchecked one isn't sent
    expect(items[0].proposalId).toBe('p-1')
    expect(items[0].arguments.summary).toBe('搬家確認會議（改到 3 點）')
    expect(items[0].arguments.description).toBe('確認搬家分工')
    expect(new Date(items[0].arguments.start as string).getTime()).toBe(new Date('2026-11-18T15:00').getTime())
    expect(new Date(items[0].arguments.end as string).getTime()).toBe(new Date('2026-11-18T16:00').getTime())
    expect(await within(card()).findByRole('link', { name: '在 Google 日曆開啟' })).toHaveAttribute(
      'href',
      'https://www.google.com/calendar/event?eid=evt-1',
    )
  })

  it('shows why a proposal failed and retries it on its own', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({
        proposals: [{ ...nextMeeting, status: 'FAILED', failureReason: 'Google 日曆沒有建立這個活動（HTTP 403）' }],
      }),
    })
    const user = await renderCard()
    vi.mocked(postMeetingApi.retry).mockResolvedValue(
      run({ proposals: [{ ...nextMeeting, status: 'DONE', resultUrl: 'https://www.google.com/calendar/event?eid=evt-1' }] }),
    )

    expect(await within(card()).findByText('Google 日曆沒有建立這個活動（HTTP 403）')).toBeInTheDocument()
    await user.click(within(card()).getByRole('button', { name: '重試' }))

    expect(postMeetingApi.retry).toHaveBeenCalledWith('job-1', 'run-1', 'p-1')
    expect(postMeetingApi.execute).not.toHaveBeenCalled()
    expect(await within(card()).findByRole('link', { name: '在 Google 日曆開啟' })).toBeInTheDocument()
  })

  it('lets a failed proposal be fixed before trying again', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ proposals: [{ ...nextMeeting, status: 'FAILED', failureReason: '內容不正確：end 要晚於 start' }] }),
    })
    const user = await renderCard()
    vi.mocked(postMeetingApi.execute).mockResolvedValue(run({ proposals: [{ ...nextMeeting, status: 'DONE', resultUrl: 'https://x' }] }))
    const failed = await within(card()).findByRole('group', { name: '行事曆活動：搬家確認會議' })
    expect(within(failed).getByText('內容不正確：end 要晚於 start')).toBeInTheDocument()

    await user.type(within(failed).getByLabelText('標題'), '（改）')
    await user.click(within(failed).getByRole('button', { name: '重試' }))

    expect(postMeetingApi.retry).not.toHaveBeenCalled()
    const [[, , items]] = vi.mocked(postMeetingApi.execute).mock.calls
    expect(items.map((item) => [item.proposalId, item.arguments.summary])).toEqual([['p-1', '搬家確認會議（改）']])
  })

  it('checks the form before anything is sent', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: run({ proposals: [nextMeeting] }) })
    await renderCard()
    const meeting = await within(card()).findByRole('group', { name: '行事曆活動：搬家確認會議' })

    fireEvent.change(within(meeting).getByLabelText('結束'), { target: { value: '2026-11-18T13:00' } })

    expect(within(meeting).getByText('結束時間要晚於開始時間')).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: '執行勾選的項目' })).toBeDisabled()

    fireEvent.change(within(meeting).getByLabelText('結束'), { target: { value: '' } })
    expect(within(meeting).getByText('請填開始與結束時間')).toBeInTheDocument()
  })

  it('cannot carry out nothing', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: run({ proposals: [nextMeeting] }) })
    const user = await renderCard()
    const meeting = await within(card()).findByRole('group', { name: '行事曆活動：搬家確認會議' })

    await user.click(within(meeting).getByRole('checkbox', { name: '執行這一項' }))

    expect(within(card()).getByRole('button', { name: '執行勾選的項目' })).toBeDisabled()
  })

  it('drafts the minutes email with the recipients the user fills in, and links to the draft', async () => {
    const minutes = {
      ...nextMeeting,
      id: 'p-3',
      service: 'gmail',
      tool: 'gmail_create_draft',
      kind: 'email_draft',
      arguments: { to: [], subject: '搬家會議紀錄', body: '各位好，今天確認了搬家分工。' },
    }
    vi.mocked(postMeetingApi.get).mockResolvedValue({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: run({ proposals: [minutes] }) })
    const user = await renderCard()
    const draft = await within(card()).findByRole('group', { name: 'email 草稿：搬家會議紀錄' })
    expect(within(draft).getByLabelText('收件人')).toHaveValue('')
    expect(within(draft).getByLabelText('主旨')).toHaveValue('搬家會議紀錄')
    expect(within(draft).getByLabelText('內文')).toHaveValue('各位好，今天確認了搬家分工。')
    vi.mocked(postMeetingApi.execute).mockResolvedValue(
      run({ proposals: [{ ...minutes, status: 'DONE', resultUrl: 'https://mail.google.com/mail/u/0/#drafts?compose=msg-1' }] }),
    )

    await user.type(within(draft).getByLabelText('收件人'), 'a@example.com, b@example.com')
    await user.click(within(card()).getByRole('button', { name: '執行勾選的項目' }))

    const [[, , items]] = vi.mocked(postMeetingApi.execute).mock.calls
    expect(items[0].arguments.to).toEqual(['a@example.com', 'b@example.com'])
    expect(await within(card()).findByRole('link', { name: '在 Gmail 開啟' })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/u/0/#drafts?compose=msg-1',
    )
  })

  it('can draft the email with no recipients yet', async () => {
    const minutes = {
      ...nextMeeting,
      id: 'p-3',
      service: 'gmail',
      tool: 'gmail_create_draft',
      kind: 'email_draft',
      arguments: { to: [], subject: '搬家會議紀錄', body: '內文' },
    }
    vi.mocked(postMeetingApi.get).mockResolvedValue({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: run({ proposals: [minutes] }) })
    const user = await renderCard()
    await within(card()).findByRole('group', { name: 'email 草稿：搬家會議紀錄' })
    vi.mocked(postMeetingApi.execute).mockResolvedValue(run({ proposals: [{ ...minutes, status: 'DONE', resultUrl: 'https://x' }] }))

    await user.click(within(card()).getByRole('button', { name: '執行勾選的項目' }))

    const [[, , items]] = vi.mocked(postMeetingApi.execute).mock.calls
    expect(items[0].arguments).toEqual({ to: [], subject: '搬家會議紀錄', body: '內文' })
  })

  it('points out a recipient that is not an email address', async () => {
    const minutes = {
      ...nextMeeting,
      id: 'p-3',
      service: 'gmail',
      tool: 'gmail_create_draft',
      kind: 'email_draft',
      arguments: { to: [], subject: '搬家會議紀錄', body: '內文' },
    }
    vi.mocked(postMeetingApi.get).mockResolvedValue({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: run({ proposals: [minutes] }) })
    const user = await renderCard()
    const draft = await within(card()).findByRole('group', { name: 'email 草稿：搬家會議紀錄' })

    await user.type(within(draft).getByLabelText('收件人'), '王小明')

    expect(within(draft).getByText('這些不是 email 地址：王小明')).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: '執行勾選的項目' })).toBeDisabled()
  })

  it('writes one Notion page per meeting with its notes and an editable todo list', async () => {
    const notesPage = {
      ...nextMeeting,
      id: 'p-4',
      service: 'notion',
      tool: 'notion_create_meeting_page',
      kind: 'notion_page',
      arguments: {
        title: '搬家會議紀錄',
        content: '## 決議\n- 下週三再開會',
        todos: [
          { title: '聯繫搬家公司', assignee: '金萊', due: '2026-11-20', timestamp: '12:34' },
          { title: '整理停車位調查' },
        ],
      },
    }
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ proposals: [notesPage] }),
    })
    const user = await renderCard()
    const page = await within(card()).findByRole('group', { name: 'Notion 會議紀錄：搬家會議紀錄' })
    expect(within(page).getByLabelText('會議紀錄')).toHaveValue('## 決議\n- 下週三再開會')
    expect(within(page).getByLabelText('待辦 1')).toHaveValue('聯繫搬家公司')
    expect(within(page).getByLabelText('待辦 1 期限')).toHaveValue('2026-11-20')
    vi.mocked(postMeetingApi.execute).mockResolvedValue(
      run({ proposals: [{ ...notesPage, status: 'DONE', resultUrl: 'https://app.notion.com/p/new1' }] }),
    )

    await user.clear(within(page).getByLabelText('待辦 1 負責人'))
    await user.type(within(page).getByLabelText('待辦 1 負責人'), '王經理')
    await user.click(within(page).getByRole('button', { name: '刪除待辦 2' }))
    await user.click(within(page).getByRole('button', { name: '新增待辦' }))
    await user.type(within(page).getByLabelText('待辦 2'), '訂餐廳')
    await user.click(within(card()).getByRole('button', { name: '執行勾選的項目' }))

    const [[, , items]] = vi.mocked(postMeetingApi.execute).mock.calls
    expect(items).toEqual([
      {
        proposalId: 'p-4',
        arguments: {
          title: '搬家會議紀錄',
          content: '## 決議\n- 下週三再開會',
          todos: [
            { title: '聯繫搬家公司', assignee: '王經理', due: '2026-11-20', timestamp: '12:34' },
            { title: '訂餐廳', assignee: '', due: '', timestamp: '' },
          ],
        },
      },
    ])
    expect(await within(card()).findByRole('link', { name: '在 Notion 開啟' })).toHaveAttribute(
      'href',
      'https://app.notion.com/p/new1',
    )
  })

  it('will not send a Notion page with a todo left blank', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({
        proposals: [{
          ...nextMeeting,
          id: 'p-4',
          service: 'notion',
          tool: 'notion_create_meeting_page',
          kind: 'notion_page',
          arguments: { title: '搬家會議紀錄', content: '內容', todos: [] },
        }],
      }),
    })
    const user = await renderCard()
    const page = await within(card()).findByRole('group', { name: 'Notion 會議紀錄：搬家會議紀錄' })

    await user.click(within(page).getByRole('button', { name: '新增待辦' }))

    expect(within(page).getByText('每條待辦都要填內容')).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: '執行勾選的項目' })).toBeDisabled()
  })

  it('creates a todo in Google Tasks with the owner and due date the user confirmed', async () => {
    const todo = {
      ...nextMeeting,
      id: 'p-6',
      service: 'google_tasks',
      tool: 'tasks_create_task',
      kind: 'google_task',
      arguments: { title: '聯繫搬家公司', notes: '問三家的報價', assignee: '金萊', due: '2026-11-20', timestamp: '12:34' },
    }
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ proposals: [todo] }),
    })
    const user = await renderCard()
    const item = await within(card()).findByRole('group', { name: 'Google Tasks 待辦：聯繫搬家公司' })
    expect(within(item).getByLabelText('期限')).toHaveValue('2026-11-20')
    expect(within(item).getByLabelText('依據的錄音時間')).toHaveValue('12:34')
    vi.mocked(postMeetingApi.execute).mockResolvedValue(
      run({ proposals: [{ ...todo, status: 'DONE', resultUrl: 'https://tasks.google.com/task/t-1' }] }),
    )

    await user.clear(within(item).getByLabelText('負責人'))
    await user.type(within(item).getByLabelText('負責人'), '王經理')
    await user.clear(within(item).getByLabelText('期限'))
    await user.click(within(card()).getByRole('button', { name: '執行勾選的項目' }))

    const [[, , items]] = vi.mocked(postMeetingApi.execute).mock.calls
    expect(items).toEqual([
      {
        proposalId: 'p-6',
        arguments: { title: '聯繫搬家公司', notes: '問三家的報價', assignee: '王經理', due: '', timestamp: '12:34' },
      },
    ])
    expect(await within(card()).findByRole('link', { name: '在 Google Tasks 開啟' })).toHaveAttribute(
      'href',
      'https://tasks.google.com/task/t-1',
    )
  })

  it('marks what an earlier run already created and leaves it unchecked', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [],
      earlierRuns: [],
      latestRun: run({ proposals: [{ ...nextMeeting, previouslyCreated: true }, movers] }),
    })
    const user = await renderCard()
    const meeting = await within(card()).findByRole('group', { name: '行事曆活動：搬家確認會議' })

    expect(within(meeting).getByText('上次已建立')).toBeInTheDocument()
    expect(within(meeting).getByRole('checkbox', { name: '執行這一項' })).not.toBeChecked()
    const other = within(card()).getByRole('group', { name: '行事曆活動：搬家公司看場地' })
    expect(within(other).queryByText('上次已建立')).not.toBeInTheDocument()
    expect(within(other).getByRole('checkbox', { name: '執行這一項' })).toBeChecked()
    vi.mocked(postMeetingApi.execute).mockResolvedValue(run({ proposals: [nextMeeting, { ...movers, status: 'DONE' }] }))

    await user.click(within(card()).getByRole('button', { name: '執行勾選的項目' }))

    const [[, , items]] = vi.mocked(postMeetingApi.execute).mock.calls
    expect(items.map((item) => item.proposalId)).toEqual(['p-2'])
  })

  it('shows earlier runs with what was created and what was left', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [],
      latestRun: run({ id: 'run-2', proposals: [] }),
      earlierRuns: [
        run({
          id: 'run-1',
          proposals: [
            { ...nextMeeting, status: 'DONE', resultUrl: 'https://www.google.com/calendar/event?eid=evt-1' },
            { ...movers, status: 'FAILED', failureReason: 'Google 日曆沒有建立這個活動（HTTP 403）' },
            { ...movers, id: 'p-3', arguments: { ...movers.arguments, summary: '訂餐廳' } },
          ],
        }),
      ],
    })
    const user = await renderCard()

    await user.click(await within(card()).findByText('之前的會後處理（1）'))

    const history = within(card()).getByRole('group', { name: '之前的會後處理' })
    expect(within(history).getByRole('link', { name: '在 Google 日曆開啟' })).toHaveAttribute(
      'href',
      'https://www.google.com/calendar/event?eid=evt-1',
    )
    expect(within(history).getByText('Google 日曆沒有建立這個活動（HTTP 403）')).toBeInTheDocument()
    expect(within(history).getByText('沒有執行')).toBeInTheDocument()
    expect(within(history).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('passes on hints about what it cannot do yet', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: ['想讓會後處理寫進 Notion，請到設定頁指定會議紀錄頁面與待辦資料庫'], earlierRuns: [],
      latestRun: null,
    })
    await renderCard()

    expect(await within(card()).findByText('想讓會後處理寫進 Notion，請到設定頁指定會議紀錄頁面與待辦資料庫')).toBeInTheDocument()
  })

  it('says when there was nothing to do', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: run() })
    await renderCard()

    expect(await within(card()).findByText('這場會議沒有需要處理的事項')).toBeInTheDocument()
  })

  it('keeps the proposals of a run that stopped at its limit, and says so', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ status: 'LIMIT_REACHED', proposals: [nextMeeting] }),
    })
    await renderCard()

    expect(await within(card()).findByText(/已達上限/)).toBeInTheDocument()
    expect(within(card()).getByDisplayValue('搬家確認會議')).toBeInTheDocument()
  })

  it('says a run that stopped at the limit did not get to any proposals, rather than that there was nothing to do', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ status: 'LIMIT_REACHED', proposals: [] }),
    })
    await renderCard()

    expect(await within(card()).findByText(/已達上限.*還沒整理出任何提案/)).toBeInTheDocument()
    expect(within(card()).queryByText('這場會議沒有需要處理的事項')).not.toBeInTheDocument()
    expect(within(card()).queryByText(/以下是已經整理好的提案/)).not.toBeInTheDocument()
  })

  it('shows why a run failed and lets it run again', async () => {
    vi.mocked(postMeetingApi.get).mockResolvedValue({
      available: true,
      unavailableReason: null,
      hints: [], earlierRuns: [],
      latestRun: run({ status: 'FAILED', failureReason: 'openai（gpt-5）額度不足：HTTP 402' }),
    })
    await renderCard()

    expect(await within(card()).findByText('openai（gpt-5）額度不足：HTTP 402')).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: '開始會後處理' })).toBeEnabled()
  })

  it('says why it could not start', async () => {
    const user = await renderCard()
    vi.mocked(postMeetingApi.start).mockRejectedValue(
      new ApiError(409, { error: 'FAILED_PRECONDITION', message: 'Google 連結已失效，請到設定頁重新連結' }),
    )

    await user.click(await within(card()).findByRole('button', { name: '開始會後處理' }))

    expect(await screen.findByText('Google 連結已失效，請到設定頁重新連結')).toBeInTheDocument()
  })
})

describe('JobDetailPage decisions (決策, COMPLETED, desktop layout)', () => {
  // multiSpeakerTranscript: S1 主持人 / S2 講者 2; 大家好 at 0:04 is S2's
  const extracting: DecisionExtraction = {
    status: 'GENERATING', failureReason: null, sourceRevision: 0, modelProvider: null, model: null,
    requestedAt: '2026-10-04T03:00:00Z', completedAt: null,
  }
  const extracted = { ...extracting, status: 'COMPLETED' as const, model: 'qwen3:14b', completedAt: '2026-10-04T03:01:00Z' }
  const decision = (overrides: Partial<Decision>): Decision => ({
    id: 'd1', jobId: 'job-1', statement: '資料庫用 PostgreSQL', rationale: '需要 pgvector', alternatives: ['MySQL'],
    proposedBy: 'S2', proposedByName: '講者 2', tentative: false, startTime: 4, evidenceText: '大家好', source: 'ai', edited: false,
    supersedes: null, supersededBy: [], meetingAt: null, createdAt: '2026-10-04T03:01:00Z', ...overrides,
  })
  const decisions = [
    decision({}),
    decision({ id: 'd2', statement: '上線日期暫定月底', rationale: '', alternatives: [], proposedBy: null, tentative: true, startTime: 6, evidenceText: '先聊聊近況' }),
  ]

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('extracts the decisions in the background, then lists what was decided, why, instead of what, by whom', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.extract).mockResolvedValue(extracting)
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('決策')

    await user.click(screen.getByRole('button', { name: '抽出決策' }))
    expect(decisionsApi.extract).toHaveBeenCalledWith('job-1')
    expect(screen.getByText('抽取中…')).toBeInTheDocument()

    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    await vi.advanceTimersByTimeAsync(3000)

    const list = await screen.findByRole('list', { name: '這場的決策' })
    const [postgres, launch] = within(list).getAllByRole('listitem')
    expect(postgres).toHaveTextContent('資料庫用 PostgreSQL')
    expect(postgres).toHaveTextContent('理由：需要 pgvector')
    expect(postgres).toHaveTextContent('沒選：MySQL')
    expect(postgres).toHaveTextContent('提出：講者 2')
    expect(postgres).toHaveTextContent('大家好')
    expect(within(postgres).queryByText('暫定')).toBeNull()
    expect(within(launch).getByText('暫定')).toBeInTheDocument()
    expect(launch).not.toHaveTextContent('理由')
    expect(screen.getByText('由 qwen3:14b 抽取')).toBeInTheDocument()
  })

  it('plays from where a decision was made', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    await renderCompletedJob(multiSpeakerTranscript)
    await openStudioTool('決策')

    const list = await screen.findByRole('list', { name: '這場的決策' })
    fireEvent.click(within(list).getByRole('button', { name: '0:04' }))

    expect(renderedMediaElement().currentTime).toBe(4)
  })

  it('shows how many decisions there are on the tile, and that they are being extracted', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracting, decisions: [] })
    await renderCompletedJob(multiSpeakerTranscript)
    const tile = await screen.findByRole('button', { name: '決策' })
    expect(tile).toHaveAccessibleDescription('抽取中…')

    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    await vi.advanceTimersByTimeAsync(3000)

    await waitFor(() => expect(tile).toHaveAccessibleDescription('2 個決策'))
  })

  it('can extract them again any time, not only once the transcript has changed', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    vi.mocked(decisionsApi.extract).mockResolvedValue(extracting)
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('決策')
    await screen.findByRole('list', { name: '這場的決策' })

    expect(screen.queryByText('逐字稿已修改，這些決策可能過時')).toBeNull()
    await user.click(screen.getByRole('button', { name: '重新抽出' }))

    expect(decisionsApi.extract).toHaveBeenCalledWith('job-1')
  })

  it('says when nothing was decided', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions: [] })
    await renderCompletedJob(multiSpeakerTranscript)
    await openStudioTool('決策')

    expect(await screen.findByText('這場沒有找到做成的決定')).toBeInTheDocument()
  })

  const card = (statement: string) => screen.getByText(statement).closest('li') as HTMLElement

  it('edits a decision in place, and marks it as changed', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    vi.mocked(decisionsApi.update).mockResolvedValue(
      decision({ statement: '資料庫確定用 PostgreSQL 16', alternatives: ['MySQL', 'SQLite'], proposedBy: 'S1', tentative: true, edited: true }),
    )
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('決策')
    await screen.findByRole('list', { name: '這場的決策' })

    await user.click(within(card('資料庫用 PostgreSQL')).getByRole('button', { name: '修改' }))
    const form = screen.getByRole('form', { name: '修改決策' })
    await user.clear(within(form).getByRole('textbox', { name: '決定' }))
    await user.type(within(form).getByRole('textbox', { name: '決定' }), '資料庫確定用 PostgreSQL 16')
    await user.type(within(form).getByRole('textbox', { name: '沒選的選項（一行一個）' }), '{Enter}SQLite')
    await user.selectOptions(within(form).getByRole('combobox', { name: '提出的人' }), '主持人')
    await user.click(within(form).getByRole('checkbox', { name: '暫定' }))
    await user.click(within(form).getByRole('button', { name: '儲存' }))

    expect(decisionsApi.update).toHaveBeenCalledWith('job-1', 'd1', {
      statement: '資料庫確定用 PostgreSQL 16', rationale: '需要 pgvector', alternatives: ['MySQL', 'SQLite'], proposedBy: 'S1',
      tentative: true,
    })
    await screen.findByText('資料庫確定用 PostgreSQL 16')
    const edited = card('資料庫確定用 PostgreSQL 16')
    expect(edited).toHaveTextContent('已修改')
    expect(edited).toHaveTextContent('提出：主持人')
    expect(screen.queryByRole('form', { name: '修改決策' })).toBeNull()
  })

  it('keeps what was typed when saving fails', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    vi.mocked(decisionsApi.update).mockRejectedValue(new Error('network'))
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('決策')
    await screen.findByRole('list', { name: '這場的決策' })

    await user.click(within(card('資料庫用 PostgreSQL')).getByRole('button', { name: '修改' }))
    await user.type(screen.getByRole('textbox', { name: '理由' }), '和向量搜尋')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(await screen.findByText('決策沒有存到，請再試一次')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '理由' })).toHaveValue('需要 pgvector和向量搜尋')
  })

  it('adds a decision of their own at the playing time', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    vi.mocked(decisionsApi.create).mockResolvedValue(
      decision({ id: 'd3', statement: '週會改到週三', rationale: '', alternatives: [], proposedBy: null, startTime: 0, evidenceText: null, source: 'user' }),
    )
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('決策')
    await screen.findByRole('list', { name: '這場的決策' })

    await user.click(screen.getByRole('button', { name: '新增決策' }))
    const form = screen.getByRole('form', { name: '新增決策' })
    expect(within(form).getByRole('checkbox', { name: '附上目前播放的時間（0:00）' })).toBeChecked()
    await user.type(within(form).getByRole('textbox', { name: '決定' }), '週會改到週三')
    await user.click(within(form).getByRole('button', { name: '儲存' }))

    expect(decisionsApi.create).toHaveBeenCalledWith('job-1', {
      statement: '週會改到週三', rationale: '', alternatives: [], proposedBy: null, tentative: false, startTime: 0,
    })
    await screen.findByText('週會改到週三')
    expect(card('週會改到週三')).toHaveTextContent('自己新增')
  })

  it('deletes a decision after confirming', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    vi.mocked(decisionsApi.remove).mockResolvedValue(undefined)
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('決策')
    await screen.findByRole('list', { name: '這場的決策' })

    await user.click(within(card('資料庫用 PostgreSQL')).getByRole('button', { name: '刪除' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '刪除' }))

    expect(decisionsApi.remove).toHaveBeenCalledWith('job-1', 'd1')
    await waitFor(() => expect(screen.queryByText('資料庫用 PostgreSQL')).toBeNull())
    expect(screen.getByText('上線日期暫定月底')).toBeInTheDocument()
  })

  it('downloads the decisions as Markdown from the export menu', async () => {
    stubDesktopLayout()
    const downloads = captureDownloads()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載決策（Markdown）' }))

    expect(downloads[0].fileName).toBe('interview-決策.md')
    const markdown = await downloads[0].blob?.text()
    expect(markdown).toContain('## 1. 資料庫用 PostgreSQL\n\n- 理由：需要 pgvector\n- 沒選：MySQL\n- 提出：講者 2\n- 時間：[00:04] 「大家好」')
    expect(markdown).toContain('## 2. 上線日期暫定月底（暫定）')
  })

  it('says the decisions may be out of date once the transcript has changed, and extracts them again', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    vi.mocked(decisionsApi.extract).mockResolvedValue(extracting)
    await renderCompletedJob({ ...multiSpeakerTranscript, revision: 2 })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('決策')

    expect(await screen.findByText('逐字稿已修改，這些決策可能過時')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新抽出' }))

    expect(decisionsApi.extract).toHaveBeenCalledWith('job-1')
    expect(screen.getByText('抽取中…')).toBeInTheDocument()
    expect(screen.getByText('資料庫用 PostgreSQL')).toBeInTheDocument() // the earlier ones stay meanwhile
  })

  it('shows what a decision changed from an earlier meeting, and what later changed it, linking to them', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({
      extraction: extracted,
      decisions: [
        decision({
          supersedes: { id: 'old', jobId: 'job-sep', statement: '資料庫用 MySQL', meetingAt: '2026-09-01T04:00:00Z' },
          supersededBy: [{ id: 'newer', jobId: 'job-nov', statement: '資料庫改回 MySQL', meetingAt: '2026-11-01T04:00:00Z' }],
        }),
      ],
    })
    await renderCompletedJob(multiSpeakerTranscript)
    await openStudioTool('決策')

    const item = within(await screen.findByRole('list', { name: '這場的決策' })).getByRole('listitem')
    expect(within(item).getByText('已被取代')).toBeInTheDocument()
    expect(item).toHaveTextContent('取代了：2026/9/1「資料庫用 MySQL」')
    expect(within(item).getByRole('link', { name: '2026/9/1「資料庫用 MySQL」' })).toHaveAttribute('href', '/jobs/job-sep?decision=old')
    expect(item).toHaveTextContent('已被取代：2026/11/1「資料庫改回 MySQL」')
    expect(within(item).getByRole('link', { name: '2026/11/1「資料庫改回 MySQL」' })).toHaveAttribute('href', '/jobs/job-nov?decision=newer')
  })

  it('opens at the time and the decision the address points to (from the 決策 page)', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: extracted, decisions })
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'COMPLETED' })
    vi.mocked(transcriptApi.get).mockResolvedValue(multiSpeakerTranscript)
    vi.mocked(summaryApi.get).mockResolvedValue(mockSummary)
    vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)
    vi.mocked(qaApi.history).mockResolvedValue([])

    renderJobDetail('job-1', '?t=6&decision=d2')

    const list = await screen.findByRole('list', { name: '這場的決策' })
    expect(within(list).getAllByRole('listitem')[1]).toHaveAttribute('data-highlighted')
    await waitFor(() => expect(renderedMediaElement().currentTime).toBe(6))
    expect(currentSegmentText()).toContain('先聊聊近況')
  })

  it('shows why it failed and offers to try again', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({
      extraction: { ...extracting, status: 'FAILED', failureReason: '模型回傳的格式不正確，請再抽一次' }, decisions: [],
    })
    vi.mocked(decisionsApi.extract).mockResolvedValue(extracting)
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('決策')

    expect(await screen.findByText('模型回傳的格式不正確，請再抽一次')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再抽一次' }))

    expect(decisionsApi.extract).toHaveBeenCalledWith('job-1')
  })
})

describe('JobDetailPage speaker stats and decisions (講者數據 × 決策, COMPLETED, desktop layout)', () => {
  // multiSpeakerTranscript: S1 主持人 / S2 講者 2
  const extracted: DecisionExtraction = {
    status: 'COMPLETED', failureReason: null, sourceRevision: 0, modelProvider: 'platform', model: 'qwen3:14b',
    requestedAt: '2026-10-04T03:00:00Z', completedAt: '2026-10-04T03:01:00Z',
  }
  const decision = (overrides: Partial<Decision>): Decision => ({
    id: 'd1', jobId: 'job-1', statement: '資料庫用 PostgreSQL', rationale: '', alternatives: [], proposedBy: 'S2', proposedByName: '講者 2',
    tentative: false, startTime: 4, evidenceText: '大家好', source: 'ai', edited: false, supersedes: null, supersededBy: [], meetingAt: null,
    createdAt: '2026-10-04T03:01:00Z', ...overrides,
  })

  it('counts the decisions each speaker proposed, and opens one in 決策', async () => {
    stubDesktopLayout()
    vi.mocked(decisionsApi.list).mockResolvedValue({
      extraction: extracted,
      decisions: [decision({}), decision({ id: 'd2', statement: '上線日期暫定月底', proposedBy: null, startTime: 6 })],
    })
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup()
    await openStudioTool('講者數據')

    const table = screen.getByRole('table', { name: '每位講者的發言' })
    expect(within(table).getByRole('columnheader', { name: '決策' })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /^講者 2/ })).toHaveTextContent(/1$/)
    expect(within(table).getByRole('row', { name: /^主持人/ })).toHaveTextContent(/0$/)
    expect(screen.getByText('這場有 2 個決策')).toBeInTheDocument()
    const made = screen.getByRole('list', { name: '每位講者提出的決策' })
    expect(within(made).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '講者 2：資料庫用 PostgreSQL', '不確定是誰：上線日期暫定月底',
    ])

    await user.click(within(made).getByRole('button', { name: '講者 2：資料庫用 PostgreSQL' }))

    const decisions = await screen.findByRole('list', { name: '這場的決策' })
    expect(within(decisions).getAllByRole('listitem')[0]).toHaveAttribute('data-highlighted')
  })

  it('offers to extract them in 決策 when there are none yet', async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup()
    await openStudioTool('講者數據')

    expect(within(screen.getByRole('table', { name: '每位講者的發言' })).queryByRole('columnheader', { name: '決策' })).toBeNull()
    expect(screen.getByText('還沒抽出這場的決策')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '到「決策」抽出' }))

    expect(await screen.findByRole('button', { name: '抽出決策' })).toBeInTheDocument()
  })
})
