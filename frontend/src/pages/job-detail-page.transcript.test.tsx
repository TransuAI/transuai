import { renderJobDetail, baseJob, mockTranscript, mockSummary, mockChapters, renderCompletedJob, openStudioTool, stubDesktopLayout, stubSwitchableLayout, gappedTranscript, renderGappedTranscriptOnDesktop, searchbox, renderedMediaElement, playTo, currentSegmentText, searchableTranscript, multiSpeakerTranscript, soloTranscript } from '@/test/job-detail-page-support'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api-client'
import { describe, expect, it, vi } from 'vitest'
import { chapterApi, jobsApi, qaApi, summaryApi, transcriptApi, usageApi } from '@/lib/api'
import type { QaTurn } from '@/types/api'

describe('JobDetailPage status branches', () => {
  it('shows the simplified progress view for a non-COMPLETED job, without the three-pane workspace', async () => {
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'TRANSCRIBING' })

    renderJobDetail()

    expect(await screen.findByText('轉錄中')).toBeInTheDocument()
    expect(screen.getByText('處理中,完成後這裡會自動更新逐字稿與摘要...')).toBeInTheDocument()
    expect(screen.queryByText('問答')).not.toBeInTheDocument()
    expect(screen.queryByText('AI 工具')).not.toBeInTheDocument()
  })

  it('shows a failure to load the job as one toast that later failures replace, not a new one every poll', async () => {
    const { toast } = await import('sonner')
    const error = vi.spyOn(toast, 'error')
    vi.mocked(jobsApi.get).mockRejectedValue(
      new ApiError(429, { error: 'RATE_LIMITED', message: '使用得太頻繁，請 1 分鐘後再試' }),
    )

    renderJobDetail()

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('使用得太頻繁，請 1 分鐘後再試', expect.objectContaining({ id: expect.any(String) })),
    )
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

  it('lets the transcript be read and played from while the summary is still being made, without editing it', async () => {
    const user = userEvent.setup()
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'SUMMARIZING' })
    vi.mocked(transcriptApi.get).mockResolvedValue(mockTranscript)

    renderJobDetail()

    expect(await screen.findByText('哈囉世界')).toBeInTheDocument()
    expect(screen.getByText(/逐字稿好了，正在產生摘要/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '編輯片段' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '在這裡加筆記' })).not.toBeInTheDocument()
    expect(screen.queryByText('問答')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '0:05' }))
    expect(document.querySelector('audio')?.currentTime).toBe(5)
  })

  it('shows no transcript while it is still being transcribed', async () => {
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'TRANSCRIBING' })

    renderJobDetail()

    expect(await screen.findByText('轉錄中')).toBeInTheDocument()
    expect(transcriptApi.get).not.toHaveBeenCalled()
    expect(screen.queryByText('逐字稿')).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'AI 工具' })).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'AI 工具' }))
    await openStudioTool('AI 摘要')
    expect(await screen.findByText('這是摘要內容')).toBeInTheDocument()

    await openStudioTool('章節')
    expect(screen.getByText('開場')).toBeInTheDocument()
  })
})

// On narrow viewports the Source/Studio panes live in modal Sheets, so the transcript and
// the chapter list aren't on screen together with the Chat pane. These tests force the
// desktop layout, where Source/Chat/Studio render inline simultaneously, to exercise the
// carried-over ask -> history -> citation-seek and segment/chapter-seek behavior.
describe('JobDetailPage title (COMPLETED, desktop layout)', () => {
  it('heads the Source pane with the title, keeping the file name beside it', async () => {
    stubDesktopLayout()
    await renderCompletedJob(mockTranscript, [], { title: '王小明專訪：預算與人力', category: 'interview' })

    expect(await screen.findByRole('heading', { name: '王小明專訪：預算與人力' })).toBeInTheDocument()
    expect(screen.getByText(baseJob.fileName, { exact: false })).toBeInTheDocument()
  })

  it('heads it with the file name when there is no title', async () => {
    stubDesktopLayout()
    await renderCompletedJob()

    expect(await screen.findByRole('heading', { name: baseJob.fileName })).toBeInTheDocument()
  })

  it('lets the user change the title in place', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(jobsApi.update).mockResolvedValue({ ...baseJob, status: 'COMPLETED', title: '產品週會' })
    await renderCompletedJob(mockTranscript, [], { title: 'AI 取的標題' })

    await user.click(await screen.findByRole('button', { name: '改標題' }))
    const input = screen.getByRole('textbox', { name: '標題' })
    expect(input).toHaveValue('AI 取的標題')
    await user.clear(input)
    await user.type(input, '產品週會{Enter}')

    expect(jobsApi.update).toHaveBeenCalledWith('job-1', { title: '產品週會' })
    expect(await screen.findByRole('heading', { name: '產品週會' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '標題' })).not.toBeInTheDocument()
  })

  it('clearing the title goes back to the file name; Esc leaves it as it was', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(jobsApi.update).mockResolvedValue({ ...baseJob, status: 'COMPLETED' })
    await renderCompletedJob(mockTranscript, [], { title: 'AI 取的標題' })

    await user.click(await screen.findByRole('button', { name: '改標題' }))
    await user.type(screen.getByRole('textbox', { name: '標題' }), '改到一半{Escape}')
    expect(jobsApi.update).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'AI 取的標題' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '改標題' }))
    await user.clear(screen.getByRole('textbox', { name: '標題' }))
    await user.keyboard('{Enter}')

    expect(jobsApi.update).toHaveBeenCalledWith('job-1', { title: '' })
    expect(await screen.findByRole('heading', { name: baseJob.fileName })).toBeInTheDocument()
  })

  it('keeps what was typed when the title fails to save', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(jobsApi.update).mockRejectedValue(new Error('network'))
    await renderCompletedJob(mockTranscript, [], { title: 'AI 取的標題' })

    await user.click(await screen.findByRole('button', { name: '改標題' }))
    await user.type(screen.getByRole('textbox', { name: '標題' }), '，第二版{Enter}')

    expect(await screen.findByText('標題沒有存到')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '標題' })).toHaveValue('AI 取的標題，第二版')
  })

  it('lets the user pick the category', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(jobsApi.update).mockResolvedValue({ ...baseJob, status: 'COMPLETED', category: 'lecture' })
    await renderCompletedJob(mockTranscript, [], { category: 'meeting' })

    const category = await screen.findByRole('combobox', { name: '類型' })
    expect(category).toHaveValue('meeting')
    await user.selectOptions(category, '課程')

    expect(jobsApi.update).toHaveBeenCalledWith('job-1', { category: 'lecture' })
    await waitFor(() => expect(category).toHaveValue('lecture'))
  })

  it('puts the category back when it fails to save', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(jobsApi.update).mockRejectedValue(new Error('network'))
    await renderCompletedJob(mockTranscript, [], { category: 'meeting' })

    const category = await screen.findByRole('combobox', { name: '類型' })
    await user.selectOptions(category, '課程')

    expect(await screen.findByText('類型沒有存到')).toBeInTheDocument()
    expect(category).toHaveValue('meeting')
  })
})

describe('JobDetailPage Studio tiles (COMPLETED, desktop layout)', () => {
  it('shows each tool as a tile saying where it stands, without the tools themselves', async () => {
    stubDesktopLayout()
    await renderCompletedJob()

    const tiles = within(await screen.findByRole('list', { name: 'AI 工具' })).getAllByRole('button')
    expect(tiles.map((tile) => tile.textContent?.slice(0, 4))).toEqual(['AI 摘', '章節1 ', '筆記還沒', '決策找出', '事實查核', '測驗還沒', '多格式輸', '會後處理', '用量尚無'])
    expect(screen.getByRole('button', { name: '章節' })).toHaveAccessibleDescription('1 個章節')
    expect(screen.queryByRole('button', { name: '0:12開場' })).not.toBeInTheDocument()
  })

  it('sums up the usage on its tile in minutes and searches, leaving tokens to the tool itself', async () => {
    stubDesktopLayout()
    vi.mocked(usageApi.getJobUsage).mockResolvedValue({
      records: [
        { kind: 'transcription', feature: 'transcription', provider: 'deepgram', model: 'nova-3', keySource: 'platform', inputTokens: null, outputTokens: null, audioSeconds: 1452, succeeded: true, createdAt: '2026-01-01T00:00:00Z' },
        { kind: 'llm', feature: 'summary', provider: 'platform', model: 'qwen3:14b', keySource: 'platform', inputTokens: 300000, outputTokens: 39056, audioSeconds: null, succeeded: true, createdAt: '2026-01-01T00:01:00Z' },
      ],
      totals: { inputTokens: 300000, outputTokens: 39056, audioSeconds: 1452 },
    })
    await renderCompletedJob()

    const tile = await screen.findByRole('button', { name: '用量' })
    await waitFor(() => expect(tile).toHaveAccessibleDescription(/^轉錄 /))
    expect(tile).not.toHaveTextContent('tokens')
  })

  it('opens a tool, and goes back to the tiles with the focus on the tool it came from', async () => {
    stubDesktopLayout()
    const user = userEvent.setup()
    await renderCompletedJob()

    await user.click(await screen.findByRole('button', { name: '章節' }))
    expect(screen.getByRole('button', { name: '0:12開場' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'AI 工具' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回 AI 工具' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '返回 AI 工具' }))
    expect(screen.getByRole('list', { name: 'AI 工具' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '章節' })).toHaveFocus()
  })
})

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
      { question: '第三句在說什麼?', answer: '在說第三句', sourceTimestamps: [13], createdAt: '2026-01-01T00:00:00Z', modelProvider: null, model: null },
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
    await openStudioTool('章節')
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
    { question: '第三句在說什麼?', answer: '在說第三句', sourceTimestamps: [13], createdAt: '2026-01-01T00:00:00Z', modelProvider: null, model: null },
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

describe('JobDetailPage mini player speakers (COMPLETED, narrow viewport)', () => {
  it("puts the current speaker's name before the current segment's text", async () => {
    await renderCompletedJob(multiSpeakerTranscript)

    playTo(renderedMediaElement(), 5)

    const line = await within(screen.getByRole('region', { name: '播放器' })).findByText('大家好')
    expect(line).toHaveTextContent('講者 2：大家好')
  })

  it('shows only the text when there is a single speaker', async () => {
    await renderCompletedJob(soloTranscript)

    playTo(renderedMediaElement(), 5)

    const line = await within(screen.getByRole('region', { name: '播放器' })).findByText('大家好')
    expect(line).toHaveTextContent(/^大家好$/)
  })
})
