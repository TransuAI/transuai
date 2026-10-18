import { platformModel, gpt5, renderJobDetail, baseJob, mockTranscript, mockSummary, mockChapters, renderCompletedJob, openStudioTool, stubDesktopLayout, gappedTranscript, renderGappedTranscriptOnDesktop } from '@/test/job-detail-page-support'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chapterApi, jobsApi, modelsApi, notesApi, qaApi, summaryApi, transcriptApi, usageApi } from '@/lib/api'
import type { JobUsage } from '@/types/api'

describe('JobDetailPage notes (筆記, COMPLETED, desktop layout)', () => {
  const note = (noteId: string, timeSeconds: number | null, text: string, source: 'manual' | 'qa' = 'manual') => ({
    noteId, jobId: 'job-1', timeSeconds, text, source, createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z',
  })
  const notesList = () => screen.getByRole('list', { name: '筆記' })

  it('lists the notes by time in the Studio, each time playing from there', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(notesApi.list).mockResolvedValue([note('n1', 12, '這裡很重要'), note('n2', 30, ''), note('n3', null, '整體心得', 'qa')])
    await renderCompletedJob()

    await waitFor(() => expect(screen.getByRole('button', { name: '筆記' })).toHaveAccessibleDescription('3 則筆記'))
    await openStudioTool('筆記')
    const items = within(notesList()).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('這裡很重要')
    expect(items[1]).toHaveTextContent('書籤') // a time and no text
    expect(items[2]).toHaveTextContent('未釘時間')
    expect(items[2]).toHaveTextContent('從問答存的')
    await user.click(within(items[0]).getByRole('button', { name: '0:12' }))
    expect((document.querySelector('audio') as HTMLMediaElement).currentTime).toBe(12)
  })

  it('adds a note without a time', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(notesApi.create).mockResolvedValue(note('n1', null, '下次要問預算'))
    await renderCompletedJob()
    await openStudioTool('筆記')
    expect(screen.getByText(/還沒有筆記/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新增筆記' }))
    await user.type(screen.getByRole('textbox', { name: '新筆記' }), '下次要問預算')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(notesApi.create).toHaveBeenCalledWith('job-1', { text: '下次要問預算' })
    expect(await within(notesList()).findByText('下次要問預算')).toBeInTheDocument()
  })

  it('bookmarks where playback is now, then opens it to write in', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(notesApi.create).mockResolvedValue(note('n1', 42.3, ''))
    vi.mocked(notesApi.update).mockResolvedValue(note('n1', 42.3, '預算這段'))
    await renderCompletedJob()
    await openStudioTool('筆記')
    ;(document.querySelector('audio') as HTMLMediaElement).currentTime = 42.34

    await user.click(screen.getByRole('button', { name: '在目前時間加筆記' }))
    expect(notesApi.create).toHaveBeenCalledWith('job-1', { timeSeconds: 42.3 })
    await user.type(await screen.findByRole('textbox', { name: '編輯筆記' }), '預算這段')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(notesApi.update).toHaveBeenCalledWith('job-1', 'n1', '預算這段')
    expect(await within(notesList()).findByText('預算這段')).toBeInTheDocument()
  })

  it('edits a note, and deletes one only once confirmed', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(notesApi.list).mockResolvedValue([note('n1', 12, '這裡很重要')])
    vi.mocked(notesApi.update).mockResolvedValue(note('n1', 12, '這裡很重要，週五前回覆'))
    vi.mocked(notesApi.remove).mockResolvedValue(undefined)
    await renderCompletedJob()
    await openStudioTool('筆記')

    await user.click(await screen.findByRole('button', { name: '編輯筆記' }))
    const editor = screen.getByRole('textbox', { name: '編輯筆記' })
    await user.clear(editor)
    await user.type(editor, '這裡很重要，週五前回覆{Control>}{Enter}{/Control}')
    expect(notesApi.update).toHaveBeenCalledWith('job-1', 'n1', '這裡很重要，週五前回覆')
    expect(await within(notesList()).findByText('這裡很重要，週五前回覆')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '刪除筆記' }))
    expect(notesApi.remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '刪除' }))
    expect(notesApi.remove).toHaveBeenCalledWith('job-1', 'n1')
    expect(await screen.findByText(/還沒有筆記/)).toBeInTheDocument()
  })

  it('keeps what was typed when a note cannot be saved', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(notesApi.create).mockRejectedValue(new Error('network'))
    await renderCompletedJob()
    await openStudioTool('筆記')

    await user.click(screen.getByRole('button', { name: '新增筆記' }))
    await user.type(screen.getByRole('textbox', { name: '新筆記' }), '不要弄丟')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(await screen.findByText('筆記沒有存到')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '新筆記' })).toHaveValue('不要弄丟')
  })
})

describe('JobDetailPage adding notes while listening (筆記)', () => {
  const note = (noteId: string, timeSeconds: number | null, text: string, source: 'manual' | 'qa' = 'manual') => ({
    noteId, jobId: 'job-1', timeSeconds, text, source, createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z',
  })
  const audio = () => document.querySelector('audio') as HTMLMediaElement

  it('bookmarks where playback is from the button by the player, and opens the note to write in', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(notesApi.create).mockResolvedValue(note('n1', 42.3, ''))
    await renderGappedTranscriptOnDesktop()
    audio().currentTime = 42.34

    await user.click(screen.getByRole('button', { name: '加筆記' }))

    expect(notesApi.create).toHaveBeenCalledWith('job-1', { timeSeconds: 42.3 })
    expect(await screen.findByRole('textbox', { name: '編輯筆記' })).toHaveFocus()
  })

  it('does the same on the N key, but not while typing', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(notesApi.create).mockResolvedValue(note('n1', 5, ''))
    await renderGappedTranscriptOnDesktop()
    audio().currentTime = 5

    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), 'n')
    expect(notesApi.create).not.toHaveBeenCalled()

    ;(document.activeElement as HTMLElement).blur()
    await user.keyboard('n')
    expect(notesApi.create).toHaveBeenCalledWith('job-1', { timeSeconds: 5 })
  })

  it('adds a note at a segment from its actions', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(notesApi.create).mockResolvedValue(note('n1', 8, ''))
    await renderGappedTranscriptOnDesktop()

    const row = screen.getByText('第二句').closest('[data-segment-index]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: '在這裡加筆記' }))

    expect(notesApi.create).toHaveBeenCalledWith('job-1', { timeSeconds: 8 })
    expect(await screen.findByRole('textbox', { name: '編輯筆記' })).toBeInTheDocument()
  })

  it('marks the segments that have notes, and opens the note from the mark', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    // 11s falls in the silence after 第二句 (8–10s): it's marked there, not on the next one.
    vi.mocked(notesApi.list).mockResolvedValue([note('n1', 9, '這句要回去確認'), note('n2', 11, ''), note('n3', null, '心得')])
    await renderGappedTranscriptOnDesktop()

    const row = screen.getByText('第二句').closest('[data-segment-index]') as HTMLElement
    const mark = await within(row).findByRole('button', { name: '筆記：這句要回去確認' })
    expect(within(row).getByRole('button', { name: '筆記：書籤' })).toBeInTheDocument()
    expect(within(screen.getByText('第一句').closest('[data-segment-index]') as HTMLElement)
      .queryByRole('button', { name: /^筆記：/ })).not.toBeInTheDocument()

    await user.click(mark)
    expect(within(screen.getByRole('list', { name: '筆記' })).getByText('這句要回去確認')).toBeInTheDocument()
  })

  it('saves an answer as a note, without its web links and at its first cited time', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(notesApi.create).mockResolvedValue(note('n1', 42, '預算要砍一成。', 'qa'))
    await renderCompletedJob(mockTranscript, [{
      question: '預算怎麼了？', answer: '預算要砍一成 [1]。', sourceTimestamps: [42, 50], createdAt: '2026-01-01T00:00:00Z',
      modelProvider: 'platform', model: 'Qwen/Qwen3.5-9B', webSearch: true, webSources: [{ title: 't', url: 'https://example.com' }],
    }])

    await user.click(await screen.findByRole('button', { name: '存成筆記' }))

    expect(notesApi.create).toHaveBeenCalledWith('job-1', { text: '預算要砍一成。', timeSeconds: 42, source: 'qa' })
    expect(await screen.findByText('已存成筆記')).toBeInTheDocument()
  })

  it('adds a note from the mini player on a phone', async () => {
    const user = userEvent.setup()
    vi.mocked(notesApi.create).mockResolvedValue(note('n1', 3, ''))
    await renderCompletedJob(gappedTranscript)
    const player = await screen.findByRole('region', { name: '播放器' })
    await waitFor(() => expect(player.querySelector('audio')).not.toBeNull())
    audio().currentTime = 3

    await user.click(within(player).getByRole('button', { name: '加筆記' }))

    expect(notesApi.create).toHaveBeenCalledWith('job-1', { timeSeconds: 3 })
    expect(await within(await screen.findByRole('dialog')).findByRole('textbox', { name: '編輯筆記' })).toBeInTheDocument()
  })
})

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

  it('folds the side panes into rails and back, keeping the same player', async () => {
    const matchMediaSpy = stubDesktopLayout()
    const user = userEvent.setup()
    await renderCompletedJob()
    const audio = document.querySelector('audio')

    await user.click(screen.getByRole('button', { name: '收合來源' }))
    await user.click(screen.getByRole('button', { name: '收合 AI 工具' }))
    expect(screen.getByRole('button', { name: '展開來源' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展開 AI 工具' })).toBeInTheDocument()
    // Folded, not unmounted: playback carries on.
    expect(document.querySelector('audio')).toBe(audio)

    await user.click(screen.getByRole('button', { name: '展開來源' }))
    await user.click(screen.getByRole('button', { name: '展開 AI 工具' }))
    expect(screen.queryByRole('button', { name: '展開來源' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收合來源' })).toBeInTheDocument()
    expect(document.querySelector('audio')).toBe(audio)

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
    await openStudioTool('章節')
    await user.click(await screen.findByRole('button', { name: '0:12開場' }))

    const audio = document.querySelector('audio')
    expect(audio?.currentTime).toBe(12)

    matchMediaSpy.mockRestore()
  })
})

describe('JobDetailPage web search (查網路, COMPLETED, desktop layout)', () => {
  const pgvector = { title: 'pgvector: Open-source vector search for Postgres', url: 'https://github.com/pgvector/pgvector' }

  const searchedThisMonth = (succeeded: number) => ({
    month: '2026-09', llm: [], transcription: [], webSearches: { succeeded, failed: 0 },
    limits: { transcriptionMinutes: 600, platformTokens: 2000000, webSearches: 30 },
  })

  beforeEach(() => {
    vi.mocked(modelsApi.available).mockResolvedValue({ models: [platformModel, gpt5], openrouterCustom: false, webSearch: true })
    vi.mocked(usageApi.getMonthly).mockResolvedValue(searchedThisMonth(0))
  })

  async function ask(user: ReturnType<typeof userEvent.setup>, question = 'pgvector 是什麼？') {
    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), `${question}{Enter}`)
  }

  it('offers no switch when the deployment cannot search the web', async () => {
    stubDesktopLayout()
    vi.mocked(modelsApi.available).mockResolvedValue({ models: [platformModel, gpt5], openrouterCustom: false, webSearch: false })
    await renderCompletedJob()
    await screen.findByRole('combobox', { name: '回答的模型' })

    expect(screen.queryByRole('button', { name: '查網路' })).not.toBeInTheDocument()
  })

  it('searches the web only once switched on, and stays on for the next question', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(qaApi.ask).mockResolvedValue(undefined)
    await renderCompletedJob()
    const toggle = await screen.findByRole('button', { name: '查網路', pressed: false })

    await ask(user, '第一題')
    await user.click(toggle)
    await ask(user, '第二題')
    await ask(user, '第三題')

    expect(vi.mocked(qaApi.ask).mock.calls.map((call) => call[2].webSearch ?? false)).toEqual([false, true, true])
    expect(screen.getByRole('button', { name: '查網路', pressed: true })).toBeInTheDocument()
  })

  it('lists the web sources under the answer, and links each [n] in it to its source', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(qaApi.ask).mockImplementation(async (_jobId, _question, handlers) => {
      handlers.onSources([12])
      handlers.onWebSources?.({ sources: [pgvector], failed: false })
      handlers.onDelta('它是 Postgres 的向量檢索擴充 [1]。')
    })
    await renderCompletedJob()
    await user.click(await screen.findByRole('button', { name: '查網路' }))

    await ask(user)

    const sources = await screen.findByRole('list', { name: '網路來源' })
    const link = within(sources).getByRole('link', { name: /pgvector: Open-source vector search for Postgres/ })
    expect(link).toHaveAttribute('href', pgvector.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(sources).getByText('github.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '網路來源 1' })).toHaveAttribute('href', pgvector.url)
    expect(screen.getByRole('button', { name: '0:12' })).toBeInTheDocument() // the recording's own sources stay
  })

  it('says when the web could not be searched and the answer comes from the content only', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(qaApi.ask).mockImplementation(async (_jobId, _question, handlers) => {
      handlers.onSources([12])
      handlers.onWebSources?.({ sources: [], failed: true })
      handlers.onDelta('內容裡提到要改用 pgvector。')
    })
    await renderCompletedJob()
    await user.click(await screen.findByRole('button', { name: '查網路' }))

    await ask(user)

    expect(await screen.findByText('這次沒查到網路資料，只根據內容回答')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '網路來源' })).not.toBeInTheDocument()
  })

  it("says how many searches are left this month, and counts down after a question that searched", async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(usageApi.getMonthly).mockResolvedValue(searchedThisMonth(27))
    vi.mocked(qaApi.ask).mockResolvedValue(undefined)
    await renderCompletedJob()

    await user.click(await screen.findByRole('button', { name: '查網路' }))
    expect(await screen.findByText('本月還能查 3 次')).toBeInTheDocument()

    vi.mocked(usageApi.getMonthly).mockResolvedValue(searchedThisMonth(28))
    await ask(user)

    expect(await screen.findByText('本月還能查 2 次')).toBeInTheDocument()
  })

  it("turns the switch off, and says when searching comes back, once this month's searches are used up", async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(usageApi.getMonthly).mockResolvedValue(searchedThisMonth(30))
    vi.mocked(qaApi.ask).mockResolvedValue(undefined)
    await renderCompletedJob()

    expect(await screen.findByText('這個月的網路搜尋已用完，下個月 1 日恢復')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查網路' })).toBeDisabled()
    await ask(user)
    expect(vi.mocked(qaApi.ask).mock.calls[0][2].webSearch ?? false).toBe(false) // questions without it go on
  })

  it('keeps the web sources of earlier answers', async () => {
    stubDesktopLayout()
    await renderCompletedJob(mockTranscript, [
      { question: '第一題', answer: '見 [1]', sourceTimestamps: [], createdAt: '2026-01-01T00:00:00Z', modelProvider: 'platform',
        model: 'Qwen/Qwen3.5-9B', webSearch: true, webSources: [pgvector] },
      { question: '第二題', answer: '第二答', sourceTimestamps: [], createdAt: '2026-01-01T00:01:00Z', modelProvider: 'platform',
        model: 'Qwen/Qwen3.5-9B', webSearch: true, webSources: [] },
    ])

    const sources = await screen.findByRole('list', { name: '網路來源' })
    expect(within(sources).getByRole('link', { name: /pgvector/ })).toHaveAttribute('href', pgvector.url)
    expect(screen.getByText('這次沒查到網路資料，只根據內容回答')).toBeInTheDocument()
  })
})

describe('JobDetailPage answer steps (COMPLETED, desktop layout)', () => {
  const step = (id: string, label: string, state: 'running' | 'done' | 'failed', detail = '') => ({ id, label, state, detail })

  it('shows each step while answering, then folds them into one line that opens again', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    let finish: () => void = () => {}
    vi.mocked(qaApi.ask).mockImplementation(async (_jobId, _question, handlers) => {
      handlers.onStep?.(step('retrieve', '在內容裡找相關的段落', 'running'))
      handlers.onStep?.(step('retrieve', '在內容裡找相關的段落', 'done', '找到 5 段'))
      handlers.onSources([12])
      handlers.onStep?.(step('search', '查網路', 'running', '搜尋「pgvector」'))
      await new Promise<void>((resolve) => (finish = resolve))
      handlers.onStep?.(step('search', '查網路', 'done', '搜尋「pgvector」· 找到 2 個網頁'))
      handlers.onStep?.(step('answer', '撰寫回答', 'running'))
      handlers.onDelta('答案')
      handlers.onStep?.(step('answer', '撰寫回答', 'done'))
    })
    await renderCompletedJob()

    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), 'pgvector 是什麼？{Enter}')

    const steps = await screen.findByRole('list', { name: '回答步驟' })
    const items = within(steps).getAllByRole('listitem')
    expect(items).toHaveLength(2) // one row per step, updated in place
    expect(items[0]).toHaveTextContent('在內容裡找相關的段落')
    expect(items[0]).toHaveTextContent('找到 5 段')
    expect(items[0]).toHaveTextContent('完成')
    expect(items[1]).toHaveTextContent('查網路')
    expect(items[1]).toHaveTextContent('搜尋「pgvector」')
    expect(items[1]).toHaveTextContent('進行中')

    await act(async () => finish())

    const summary = await screen.findByRole('button', { name: /完成 3 個步驟/ })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: '回答步驟' })).not.toBeInTheDocument()
    await user.click(summary)
    expect(within(screen.getByRole('list', { name: '回答步驟' })).getAllByRole('listitem')).toHaveLength(3)
  })

  it('marks a step that failed', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(qaApi.ask).mockImplementation(async (_jobId, _question, handlers) => {
      handlers.onStep?.(step('search', '查網路', 'failed', '搜尋「pgvector」· 沒查到，只根據內容回答'))
      await new Promise(() => {}) // still answering
    })
    await renderCompletedJob()

    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), 'pgvector 是什麼？{Enter}')

    const item = within(await screen.findByRole('list', { name: '回答步驟' })).getByRole('listitem')
    expect(item).toHaveTextContent('失敗')
    expect(item).toHaveTextContent('沒查到，只根據內容回答')
  })
})

describe('JobDetailPage answering model (COMPLETED, desktop layout)', () => {
  it('leaves the model to the server while the default model is picked', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(qaApi.ask).mockResolvedValue(undefined)
    await renderCompletedJob()
    expect(await screen.findByRole('combobox', { name: '回答的模型' })).toHaveValue('platform/Qwen/Qwen3.5-9B')

    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), '預算怎麼分？{Enter}')

    // Omitted, so the server uses whatever the default model is by now.
    expect(vi.mocked(qaApi.ask).mock.calls[0][2]).not.toHaveProperty('model')
  })

  it('asks with another model when one is picked for this question', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(qaApi.ask).mockImplementation(async (_jobId, _question, handlers) => {
      handlers.onSources([1])
      handlers.onModel?.({ provider: 'openai', model: 'gpt-5', supportsTools: true })
      handlers.onDelta('答案')
    })
    await renderCompletedJob()
    const picker = await screen.findByRole('combobox', { name: '回答的模型' })
    expect(picker).toHaveValue('platform/Qwen/Qwen3.5-9B')

    await user.selectOptions(picker, 'openai/gpt-5')
    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), '預算怎麼分？{Enter}')

    expect(qaApi.ask).toHaveBeenCalledWith(
      'job-1',
      '預算怎麼分？',
      expect.objectContaining({ model: { provider: 'openai', model: 'gpt-5' } }),
    )
    expect(await screen.findByTitle('模型：gpt-5')).toBeInTheDocument()
  })

  it('says which model gave each earlier answer', async () => {
    stubDesktopLayout()
    await renderCompletedJob(mockTranscript, [
      { question: '第一題', answer: '第一答', sourceTimestamps: [], createdAt: '2026-01-01T00:00:00Z', modelProvider: 'platform', model: 'Qwen/Qwen3.5-9B' },
      { question: '第二題', answer: '第二答', sourceTimestamps: [], createdAt: '2026-01-01T00:01:00Z', modelProvider: null, model: null },
    ])

    expect(await screen.findByTitle('模型：Qwen/Qwen3.5-9B')).toBeInTheDocument()
    expect(screen.getAllByText('由 AI 回答')).toHaveLength(1)
  })
})

describe('JobDetailPage summary model (COMPLETED, desktop layout)', () => {
  it('says which model made the summary', async () => {
    stubDesktopLayout()
    await renderCompletedJob()
    await openStudioTool('AI 摘要')

    expect(await screen.findByTitle('模型：gpt-5-mini')).toBeInTheDocument()
  })

  it('says nothing about the model for a summary made before models were recorded', async () => {
    stubDesktopLayout()
    vi.mocked(summaryApi.get).mockResolvedValue({ ...mockSummary, modelProvider: null, model: null })
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'COMPLETED' })
    vi.mocked(transcriptApi.get).mockResolvedValue(mockTranscript)
    vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)
    vi.mocked(qaApi.history).mockResolvedValue([])
    renderJobDetail()
    await openStudioTool('AI 摘要')

    expect(await screen.findByText('這是摘要內容', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText(/產生$/)).not.toBeInTheDocument()
  })
})

describe('JobDetailPage usage (COMPLETED, desktop layout)', () => {
  const llmRecord = (feature: string, inputTokens: number | null, outputTokens: number | null, succeeded = true) => ({
    kind: 'llm' as const,
    feature,
    provider: 'platform',
    model: 'Qwen/Qwen3.5-9B',
    keySource: 'platform',
    inputTokens,
    outputTokens,
    audioSeconds: null,
    succeeded,
    createdAt: '2026-09-26T02:05:00Z',
  })
  const usage: JobUsage = {
    records: [llmRecord('summary', 3000, 240), llmRecord('chapters', null, null), llmRecord('qa_answer', 800, 0, false)],
    totals: { inputTokens: 3800, outputTokens: 240, audioSeconds: 0 },
  }
  const usageSection = () => screen.getByRole('region', { name: '用量' })
  const byFeature = () => within(usageSection()).getAllByRole('listitem')

  async function renderUsage(jobUsage?: JobUsage) {
    stubDesktopLayout()
    if (jobUsage) vi.mocked(usageApi.getJobUsage).mockResolvedValue(jobUsage)
    await renderCompletedJob()
    await openStudioTool('用量')
  }

  // Every single call is behind a button: a job with many questions easily has dozens.
  function showEveryCall() {
    fireEvent.click(within(usageSection()).getByRole('button', { name: /每一次呼叫/ }))
    return within(screen.getByRole('list', { name: '每一次呼叫' })).getAllByRole('listitem')
  }

  it("shows the job's totals and what each feature used, not every call", async () => {
    await renderUsage(usage)

    await within(usageSection()).findByText('3,800')
    expect(usageSection()).toHaveTextContent('輸入 tokens3,800')
    expect(usageSection()).toHaveTextContent('輸出 tokens240')
    expect(byFeature().map((row) => row.textContent)).toEqual([
      '摘要1 次3,240 tokens',
      '章節1 次—',
      '問答1 次 · 1 次失敗800 tokens',
    ])
    expect(screen.queryByRole('list', { name: '每一次呼叫' })).not.toBeInTheDocument()
  })

  it('adds up the calls of the same feature', async () => {
    await renderUsage({
      records: [llmRecord('qa_answer', 1000, 100), llmRecord('qa_answer', 2000, 200)],
      totals: { inputTokens: 3000, outputTokens: 300, audioSeconds: 0 },
    })

    expect(await within(usageSection()).findByText('2 次')).toBeInTheDocument()
    expect(byFeature()).toHaveLength(1)
    expect(byFeature()[0]).toHaveTextContent('3,300 tokens')
  })

  it('lists every call on request', async () => {
    await renderUsage(usage)
    await within(usageSection()).findByText('3,800')

    const rows = showEveryCall()
    expect(rows[0]).toHaveTextContent('摘要')
    expect(rows[0]).toHaveTextContent('Qwen/Qwen3.5-9B')
    expect(rows[0]).toHaveTextContent('3,000 → 240 tokens')
    expect(rows[1]).toHaveTextContent('章節')
    expect(rows[1]).toHaveTextContent('— → — tokens')
    expect(rows[2]).toHaveTextContent('問答')
    expect(rows[2]).toHaveTextContent('失敗')
  })

  it('shows a known number even when the other one is unknown, and marks totals that leave some out', async () => {
    await renderUsage({
      records: [llmRecord('summary', 3000, null)],
      totals: { inputTokens: 3000, outputTokens: 0, audioSeconds: 0 },
    })

    expect(await within(usageSection()).findByText('部分用量未知，未計入總計')).toBeInTheDocument()
    expect(showEveryCall()[0]).toHaveTextContent('3,000 → — tokens')
  })

  it('shows the transcription in minutes alongside the model calls', async () => {
    await renderUsage({
      records: [
        { ...llmRecord('transcription', null, null), kind: 'transcription', provider: 'deepgram', model: 'nova-3', audioSeconds: 1836 },
        llmRecord('summary', 3000, 240),
      ],
      totals: { inputTokens: 3000, outputTokens: 240, audioSeconds: 1836 },
    })

    await within(usageSection()).findByText('3,000')
    expect(usageSection()).toHaveTextContent('轉錄30.6 分鐘')
    expect(byFeature()[0]).toHaveTextContent('轉錄1 次30.6 分鐘')
    expect(usageSection()).not.toHaveTextContent('部分用量未知')
    expect(showEveryCall()[0]).toHaveTextContent('轉錄nova-330.6 分鐘')
  })

  it('shows a failed transcription with unknown minutes as a dash', async () => {
    await renderUsage({
      records: [{ ...llmRecord('transcription', null, null, false), kind: 'transcription', provider: 'deepgram', model: 'nova-3' }],
      totals: { inputTokens: 0, outputTokens: 0, audioSeconds: 0 },
    })

    await within(usageSection()).findByText('部分用量未知，未計入總計')
    expect(showEveryCall()[0]).toHaveTextContent('轉錄nova-3—失敗')
  })

  it('lists web searches as a feature of their own, counted, with every search among the calls', async () => {
    const search = (succeeded: boolean) => ({ ...llmRecord('web_search', null, null, succeeded), kind: 'web_search' as const,
      provider: 'tavily', model: '' })
    await renderUsage({
      records: [search(true), search(false)],
      totals: { inputTokens: 0, outputTokens: 0, audioSeconds: 0, webSearches: 1 },
    })

    await within(usageSection()).findByText('網路搜尋')
    expect(byFeature()[0]).toHaveTextContent(/^網路搜尋2 次 · 1 次失敗$/)
    expect(usageSection()).not.toHaveTextContent('部分用量未知')
    const calls = showEveryCall()
    expect(calls[0]).toHaveTextContent('網路搜尋tavily1 次')
    expect(calls[1]).toHaveTextContent('失敗')
  })

  it('says so when nothing has been used yet', async () => {
    await renderUsage()

    expect(await within(usageSection()).findByText('尚無用量紀錄')).toBeInTheDocument()
  })

  it('reloads the usage once an answer has finished', async () => {
    const user = userEvent.setup()
    await renderUsage()
    vi.mocked(qaApi.ask).mockImplementation(async (_jobId, _question, handlers) => {
      handlers.onDelta('答案')
    })
    vi.mocked(usageApi.getJobUsage).mockResolvedValue(usage)

    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), '預算怎麼分配？{Enter}')

    expect(await within(usageSection()).findByText('3,240 tokens')).toBeInTheDocument()
  })
})

describe('JobDetailPage answers (COMPLETED, desktop layout)', () => {
  let matchMediaSpy: ReturnType<typeof stubDesktopLayout>
  beforeEach(() => {
    matchMediaSpy = stubDesktopLayout()
  })
  afterEach(() => matchMediaSpy.mockRestore())

  it('shows an answer\'s Markdown as bold and quotes, not as raw marks', async () => {
    await renderCompletedJob(mockTranscript, [
      { question: '幾枚？', answer: '相關內容：\n> 上千枚的飛彈\n\n所以答案是**上千枚**。', sourceTimestamps: [], createdAt: '2026-01-01T00:00:00Z', modelProvider: null, model: null },
    ])

    expect(await screen.findByText('上千枚', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('上千枚的飛彈').closest('blockquote')).not.toBeNull()
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  it('lists the passages an answer drew on in recording order, each once', async () => {
    await renderCompletedJob(mockTranscript, [
      { question: '幾枚？', answer: '上千枚', sourceTimestamps: [1258, 15, 64, 15, 598], createdAt: '2026-01-01T00:00:00Z', modelProvider: null, model: null },
    ])

    const passages = (await screen.findByText('相關段落')).parentElement as HTMLElement
    expect(within(passages).getAllByRole('button').map((b) => b.textContent)).toEqual(['0:15', '1:04', '9:58', '20:58'])
  })

  it('asks a failed question again from its 重新提問, in place of the failed answer', async () => {
    const user = userEvent.setup()
    vi.mocked(qaApi.ask)
      .mockImplementationOnce(async (_jobId, _question, handlers) => handlers.onError('模型暫時無法使用'))
      .mockImplementationOnce(async (_jobId, _question, handlers) => handlers.onDelta('這次答得出來'))

    await renderCompletedJob()
    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), '這段在說什麼?')
    await user.click(screen.getByRole('button', { name: '問' }))

    expect(await screen.findByText('回答失敗')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新提問' }))

    expect(await screen.findByText('這次答得出來')).toBeInTheDocument()
    expect(qaApi.ask).toHaveBeenLastCalledWith('job-1', '這段在說什麼?', expect.any(Object))
    expect(screen.getAllByText('這段在說什麼?')).toHaveLength(1)
    expect(screen.queryByText('回答失敗')).not.toBeInTheDocument()
  })

  it('goes down to a new question, and keeps following its answer only while the user stays at the bottom', async () => {
    const user = userEvent.setup()
    let sendDelta: (text: string) => void = () => {}
    let finish: () => void = () => {}
    vi.mocked(qaApi.ask).mockImplementation(
      (_jobId, _question, handlers) =>
        new Promise<void>((resolve) => {
          sendDelta = handlers.onDelta
          finish = resolve
        }),
    )
    await renderCompletedJob(mockTranscript, [
      { question: '第一題', answer: '第一個答案', sourceTimestamps: [], createdAt: '2026-01-01T00:00:00Z', modelProvider: null, model: null },
    ])
    // jsdom lays nothing out: give the history's viewport a size, and a scrollTop that remembers what it's set to.
    const viewport = (await screen.findByText('第一題')).closest('[data-slot="scroll-area-viewport"]') as HTMLElement
    let scrollTop = 0
    let scrollHeight = 1000
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 200 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => (scrollTop = value) },
    })

    await user.type(screen.getByPlaceholderText('針對這個內容提問...'), '第二題')
    await user.click(screen.getByRole('button', { name: '問' }))
    expect(scrollTop).toBe(1000)

    // At the bottom, the answer is followed as it grows.
    scrollHeight = 1200
    act(() => sendDelta('一段'))
    expect(scrollTop).toBe(1200)

    // Scrolled up to read: left there.
    scrollTop = 100
    fireEvent.scroll(viewport)
    scrollHeight = 1400
    act(() => sendDelta('又一段'))
    expect(scrollTop).toBe(100)

    await act(async () => finish())
  })
})
