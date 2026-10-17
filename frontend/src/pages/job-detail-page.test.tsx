import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { ApiError } from '@/lib/api-client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chapterApi, jobsApi, modelsApi, notesApi, postMeetingApi, qaApi, quizApi, speakerSuggestionsApi, summaryApi, transcriptApi, usageApi, speakerInsightsApi, outputsApi, translationsApi, decisionsApi, factCheckApi } from '@/lib/api'
import type { Claim, Decision, DecisionExtraction, FactCheckExtraction, GeneratedOutput, SpeakerInsights, TranslationSummary, Chapter, Job, JobUsage, PostMeetingRun, QaTurn, Quiz, QuizAttemptResult, QuizQuestion, Summary, Transcript } from '@/types/api'

vi.mock('@/lib/api', () => ({
  systemApi: { status: vi.fn().mockResolvedValue({ setupRequired: false, mailEnabled: true }) },
  jobsApi: {
    get: vi.fn(),
    update: vi.fn(),
    getMediaUrl: vi
      .fn()
      .mockResolvedValue({ downloadUrl: 'https://media.example.com/uploads/interview.mp3', expiresAt: '2026-01-01T01:00:00Z' }),
  },
  transcriptApi: { get: vi.fn(), updateSegmentText: vi.fn(), renameSpeaker: vi.fn(), assignSegmentSpeaker: vi.fn() },
  speakerSuggestionsApi: { list: vi.fn(), setStatus: vi.fn() },
  notesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  summaryApi: { get: vi.fn(), regenerate: vi.fn() },
  chapterApi: { list: vi.fn() },
  qaApi: { ask: vi.fn(), history: vi.fn() },
  usageApi: { getJobUsage: vi.fn(), getMonthly: vi.fn() },
  modelsApi: { available: vi.fn(), getDefault: vi.fn(), setDefault: vi.fn() },
  quizApi: { list: vi.fn(), request: vi.fn(), get: vi.fn(), submitAttempt: vi.fn() },
  postMeetingApi: { get: vi.fn(), start: vi.fn(), execute: vi.fn(), retry: vi.fn() },
  speakerInsightsApi: { get: vi.fn(), request: vi.fn() },
  outputsApi: { list: vi.fn(), request: vi.fn(), update: vi.fn() },
  translationsApi: { list: vi.fn(), request: vi.fn(), get: vi.fn(), delete: vi.fn() },
  decisionsApi: { list: vi.fn(), extract: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  factCheckApi: { get: vi.fn(), find: vi.fn(), check: vi.fn() },
}))

// Every test renders the whole page, and this file runs ~250 of them in one jsdom: on a busy machine the later, longer
// ones take a few seconds (one that takes 1.3 s on its own went past the default 5 s in a full run).
vi.setConfig({ testTimeout: 15_000 })

vi.mock('@/hooks/use-job-socket', () => ({
  useJobSocket: vi.fn(),
}))

let JobDetailPage: typeof import('./job-detail-page').JobDetailPage

afterEach(() => {
  vi.restoreAllMocks()
  // Only forgets recorded calls (implementations stay), so "was not called" holds per test.
  vi.clearAllMocks()
})

const platformModel = { provider: 'platform', model: 'Qwen/Qwen3.5-9B', supportsTools: false }
const gpt5 = { provider: 'openai', model: 'gpt-5', supportsTools: true }

beforeEach(() => {
  vi.mocked(usageApi.getJobUsage).mockResolvedValue(noUsage)
  vi.mocked(modelsApi.available).mockResolvedValue({ models: [platformModel, gpt5], openrouterCustom: false })
  vi.mocked(modelsApi.getDefault).mockResolvedValue(platformModel)
  vi.mocked(quizApi.list).mockResolvedValue([])
  vi.mocked(speakerInsightsApi.get).mockResolvedValue(noInsights)
  vi.mocked(outputsApi.list).mockResolvedValue([])
  vi.mocked(translationsApi.list).mockResolvedValue([])
  vi.mocked(decisionsApi.list).mockResolvedValue({ extraction: null, decisions: [] })
  vi.mocked(factCheckApi.get).mockResolvedValue({ extraction: null, claims: [] })
  vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([])
  vi.mocked(notesApi.list).mockResolvedValue([])
  vi.mocked(postMeetingApi.get).mockResolvedValue({ available: true, unavailableReason: null, hints: [], earlierRuns: [], latestRun: null })
})

beforeAll(async () => {
  ;({ JobDetailPage } = await import('./job-detail-page'))
})

function renderJobDetail(jobId = 'job-1', search = '') {
  return render(
    <MemoryRouter initialEntries={[`/jobs/${jobId}${search}`]}>
      <Routes>
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
      </Routes>
      <Toaster />
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
  transcriptionLanguage: 'zh-TW',
}

const mockTranscript: Transcript = {
  jobId: 'job-1',
  language: 'zh',
  fullText: 'hello world',
  revision: 0,
  segments: [{ id: 'seg-1', startTime: 5, endTime: 8, speakerLabel: null, text: '哈囉世界', originalText: '哈囉世界' }],
  speakers: [],
}

const mockSummary: Summary = {
  jobId: 'job-1',
  summaryText: '這是摘要內容',
  sourceRevision: 0,
  regenerationStatus: 'IDLE',
  modelProvider: 'openai',
  model: 'gpt-5-mini',
}

const noUsage: JobUsage = { records: [], totals: { inputTokens: 0, outputTokens: 0, audioSeconds: 0 } }
const noInsights: SpeakerInsights = {
  status: 'NONE', failureReason: null, sourceRevision: 0, modelProvider: null, model: null, requestedAt: null, completedAt: null, items: [],
}

const mockChapters: Chapter[] = [{ id: 'ch-1', jobId: 'job-1', title: '開場', startTime: 12, sequenceNo: 0 }]

async function renderCompletedJob(
  transcript: Transcript = mockTranscript,
  qaHistory: QaTurn[] = [],
  job: Partial<Job> = {},
) {
  vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, ...job, status: 'COMPLETED' })
  vi.mocked(transcriptApi.get).mockResolvedValue(transcript)
  vi.mocked(summaryApi.get).mockResolvedValue(mockSummary)
  vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)
  vi.mocked(qaApi.history).mockResolvedValue(qaHistory)

  const view = renderJobDetail()
  await screen.findByText('問答')
  // The workspace can show up before the transcript's own fetch has settled; let it land so tests
  // can look at the transcript straight away.
  await waitFor(() => expect(transcriptApi.get).toHaveBeenCalled())
  await act(async () => {})
  return view
}

// The Studio shows its tools as tiles; a tool's content is only on screen once its tile is opened.
async function openStudioTool(name: string) {
  const back = screen.queryByRole('button', { name: '返回 AI 工具' })
  if (back) fireEvent.click(back)
  fireEvent.click(await screen.findByRole('button', { name }))
}

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

// Like stubDesktopLayout, but the viewport can be switched mid-test; useMediaQuery listens
// for the change and the workspace swaps layouts. Listeners get a MediaQueryListEvent-like
// `{ matches }`, which sonner's Toaster (watching prefers-color-scheme) destructures.
function stubSwitchableLayout(initiallyDesktop: boolean) {
  let isDesktop = initiallyDesktop
  const matches = (query: string) => query === '(min-width: 1024px)' && isDesktop
  const listeners = new Set<{ query: string; listener: (event: { matches: boolean }) => void }>()
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        get matches() {
          return matches(query)
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
          listeners.add({ query, listener }),
        removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
          listeners.forEach((entry) => entry.listener === listener && listeners.delete(entry)),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
  return {
    switchTo(desktop: boolean) {
      isDesktop = desktop
      act(() => listeners.forEach(({ query, listener }) => listener({ matches: matches(query) })))
    },
  }
}

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

// The segments deliberately leave a 10–12s gap to exercise the gap rule of the current
// segment (目前片段, see frontend CONTEXT.md).
const gappedTranscript: Transcript = {
  jobId: 'job-1',
  language: 'Chinese',
  fullText: '第一句 第二句 第三句',
  revision: 0,
  segments: [
    { id: 'seg-2', startTime: 5, endTime: 8, speakerLabel: null, text: '第一句', originalText: '第一句' },
    { id: 'seg-3', startTime: 8, endTime: 10, speakerLabel: null, text: '第二句', originalText: '第二句' },
    { id: 'seg-4', startTime: 12, endTime: 15, speakerLabel: null, text: '第三句', originalText: '第三句' },
  ],
  speakers: [],
}

async function renderGappedTranscriptOnDesktop(qaHistory: QaTurn[] = []) {
  stubDesktopLayout()
  await renderCompletedJob(gappedTranscript, qaHistory)
  await screen.findByText('第一句')
  return renderedMediaElement()
}

function searchbox() {
  return screen.getByRole('searchbox', { name: '搜尋逐字稿' })
}

function renderedMediaElement() {
  const media = document.querySelector('audio')
  if (!media) throw new Error('media element not rendered')
  return media
}

function playTo(media: HTMLMediaElement, seconds: number) {
  media.currentTime = seconds
  fireEvent.timeUpdate(media)
}

function currentSegmentText() {
  return document.querySelector('[aria-current="true"]')?.textContent ?? null
}

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

const searchableTranscript: Transcript = {
  jobId: 'job-1',
  language: 'Chinese',
  fullText: '',
  revision: 0,
  segments: [
    { id: 'seg-5', startTime: 0, endTime: 4, speakerLabel: null, text: '今天先討論預算', originalText: '今天先討論預算' },
    { id: 'seg-6', startTime: 4, endTime: 8, speakerLabel: null, text: '下一季的預算要再確認一次預算上限', originalText: '下一季的預算要再確認一次預算上限' },
    { id: 'seg-7', startTime: 8, endTime: 12, speakerLabel: null, text: '文件放在 API 規格裡', originalText: '文件放在 API 規格裡' },
    { id: 'seg-8', startTime: 12, endTime: 16, speakerLabel: null, text: 'api 的版本下週定案', originalText: 'api 的版本下週定案' },
  ],
  speakers: [],
}

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

// 講者 1 speaks first, then 講者 2, then 講者 1 again.
const multiSpeakerTranscript: Transcript = {
  jobId: 'job-1',
  language: 'zh-TW',
  fullText: '',
  revision: 0,
  segments: [
    { id: 'seg-d1', startTime: 0, endTime: 2, speakerLabel: 'S1', text: '歡迎收聽', originalText: '歡迎收聽' },
    { id: 'seg-d2', startTime: 2, endTime: 4, speakerLabel: 'S1', text: '今天請到來賓', originalText: '今天請到來賓' },
    { id: 'seg-d3', startTime: 4, endTime: 6, speakerLabel: 'S2', text: '大家好', originalText: '大家好' },
    { id: 'seg-d4', startTime: 6, endTime: 8, speakerLabel: 'S1', text: '先聊聊近況', originalText: '先聊聊近況' },
  ],
  speakers: [
    { label: 'S1', displayName: '主持人', displayOrder: 1 },
    { label: 'S2', displayName: '講者 2', displayOrder: 2 },
    // Every segment of 講者 3 has been moved to someone else.
    { label: 'S3', displayName: '講者 3', displayOrder: 3 },
  ],
}

// A single-speaker recording (a solo podcast): speaker labels would only be noise.
const soloTranscript: Transcript = {
  ...multiSpeakerTranscript,
  segments: multiSpeakerTranscript.segments.map((segment) => ({ ...segment, speakerLabel: 'S1' })),
  speakers: [{ label: 'S1', displayName: '講者 1', displayOrder: 1 }],
}

describe('JobDetailPage speakers (COMPLETED, desktop layout)', () => {
  const segmentRow = (text: string) => screen.getByText(text).closest('[data-segment-index]') as HTMLElement

  it('folds a big meeting\'s speakers into their heading, and opens them on request', async () => {
    stubDesktopLayout()
    const user = userEvent.setup()
    const labels = ['S1', 'S2', 'S3', 'S4', 'S5']
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: labels.map((label, i) => ({ id: `seg-${i}`, startTime: i * 2, endTime: i * 2 + 2, speakerLabel: label, text: `第 ${i} 句`, originalText: `第 ${i} 句` })),
      speakers: labels.map((label, i) => ({ label, displayName: `講者 ${i + 1}`, displayOrder: i + 1 })),
    })

    const heading = screen.getByRole('button', { name: /講者（5）/ })
    expect(heading).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '改名：講者 1' })).not.toBeInTheDocument()

    await user.click(heading)
    expect(heading).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '改名：講者 5' })).toBeInTheDocument()
  })

  it('keeps a small meeting\'s speakers open', async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    expect(screen.getByRole('button', { name: /講者（2）/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '改名：主持人' })).toBeInTheDocument()
  })

  it("shows the speaker's name only on the first segment of each turn", async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    expect(segmentRow('歡迎收聽')).toHaveTextContent('主持人：歡迎收聽')
    expect(segmentRow('今天請到來賓')).not.toHaveTextContent('主持人')
    expect(segmentRow('大家好')).toHaveTextContent('講者 2：大家好')
    expect(segmentRow('先聊聊近況')).toHaveTextContent('主持人：先聊聊近況')
  })

  it('does not start a new turn after a cleared segment of the same speaker', async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: [
        multiSpeakerTranscript.segments[0],
        { ...multiSpeakerTranscript.segments[2], text: '' },
        multiSpeakerTranscript.segments[3],
      ],
    })

    expect(segmentRow('先聊聊近況')).not.toHaveTextContent('主持人')
  })

  it('lists the speakers who have segments above the transcript, each with its own colour', async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    const panel = screen.getByRole('list', { name: '講者' })
    const items = within(panel).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['主持人', '講者 2'])
    const colours = items.map((item) => (item.querySelector('[data-speaker-colour]') as HTMLElement).style.backgroundColor)
    expect(new Set(colours).size).toBe(2)
  })

  it("marks a speaker's turn in the transcript with the speaker's colour", async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    const panelColour = (within(screen.getByRole('list', { name: '講者' })).getByText('講者 2').closest('li')
      ?.querySelector('[data-speaker-colour]') as HTMLElement).style.backgroundColor
    const turnColour = (segmentRow('大家好').querySelector('[data-speaker-colour]') as HTMLElement).style.backgroundColor
    expect(turnColour).toBe(panelColour)
  })

  it('does not list a speaker whose segments have all been cleared', async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: [
        ...multiSpeakerTranscript.segments,
        { id: 'seg-d5', startTime: 8, endTime: 9, speakerLabel: 'S3', text: '', originalText: '被清空的話' },
      ],
    })

    const items = within(screen.getByRole('list', { name: '講者' })).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['主持人', '講者 2'])
  })

  it('hides everything about speakers when only one speaker was found', async () => {
    stubDesktopLayout()
    await renderCompletedJob(soloTranscript)

    expect(screen.queryByRole('list', { name: '講者' })).not.toBeInTheDocument()
    expect(segmentRow('歡迎收聽')).not.toHaveTextContent('講者 1')
  })

  it("counts only segments that aren't cleared when deciding whether there is more than one speaker", async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: multiSpeakerTranscript.segments.map((segment) => (segment.speakerLabel === 'S2' ? { ...segment, text: '' } : segment)),
    })

    expect(screen.queryByRole('list', { name: '講者' })).not.toBeInTheDocument()
    expect(segmentRow('歡迎收聽')).not.toHaveTextContent('主持人')
  })

  it('exports subtitles with the speakers\' names', async () => {
    const user = userEvent.setup()
    let exported: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      exported = blob as Blob
      return 'blob:export'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載字幕（SRT）' }))

    expect(await exported?.text()).toContain('00:00:04,000 --> 00:00:06,000\n講者 2：大家好\n')
  })
})

describe('JobDetailPage speaker name suggestions (講者名字建議, COMPLETED)', () => {
  const panel = () => screen.getByRole('list', { name: '講者' })
  const suggestionFor = (label: string, name: string) => ({
    speakerLabel: label, name, evidenceStartTime: 4, evidenceText: `大家好，我是${name}`, status: 'pending' as const,
  })
  // Both speakers still have their default names.
  const unnamed: Transcript = {
    ...multiSpeakerTranscript,
    speakers: [{ label: 'S1', displayName: '講者 1', displayOrder: 1 }, { label: 'S2', displayName: '講者 2', displayOrder: 2 }],
  }
  const renamedTo = (label: string, name: string) => ({
    speaker: { label, displayName: name, displayOrder: label === 'S1' ? 1 : 2 }, revision: 1,
  })

  it('suggests a name with the line it comes from, which plays when its time is clicked', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S2', '李大華')])
    await renderCompletedJob(multiSpeakerTranscript)

    const suggestion = await screen.findByRole('group', { name: '講者 2 可能是 李大華' })
    expect(suggestion).toHaveTextContent('大家好，我是李大華')
    await user.click(within(suggestion).getByRole('button', { name: '0:04' }))
    expect((document.querySelector('audio') as HTMLMediaElement).currentTime).toBe(4)
  })

  it('renames the speaker when a suggestion is applied, and marks it applied', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S2', '李大華')])
    vi.mocked(transcriptApi.renameSpeaker).mockResolvedValue(renamedTo('S2', '李大華'))
    vi.mocked(speakerSuggestionsApi.setStatus).mockResolvedValue({ ...suggestionFor('S2', '李大華'), status: 'applied' })
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(within(await screen.findByRole('group', { name: '講者 2 可能是 李大華' })).getByRole('button', { name: '套用' }))

    expect(transcriptApi.renameSpeaker).toHaveBeenCalledWith('job-1', 'S2', '李大華')
    expect(speakerSuggestionsApi.setStatus).toHaveBeenCalledWith('job-1', 'S2', 'applied')
    expect(await within(panel()).findByRole('button', { name: '改名：李大華' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /可能是/ })).not.toBeInTheDocument()
  })

  it('stops suggesting once the suggestion is dismissed', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S2', '李大華')])
    vi.mocked(speakerSuggestionsApi.setStatus).mockResolvedValue({ ...suggestionFor('S2', '李大華'), status: 'dismissed' })
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(within(await screen.findByRole('group', { name: '講者 2 可能是 李大華' })).getByRole('button', { name: '忽略' }))

    expect(speakerSuggestionsApi.setStatus).toHaveBeenCalledWith('job-1', 'S2', 'dismissed')
    expect(screen.queryByRole('group', { name: /可能是/ })).not.toBeInTheDocument()
    expect(transcriptApi.renameSpeaker).not.toHaveBeenCalled()
  })

  it('applies every suggestion at once, keeping any that fails to apply', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S1', '王小明'), suggestionFor('S2', '李大華')])
    vi.mocked(transcriptApi.renameSpeaker).mockImplementation(async (_jobId, label, name) => {
      if (label === 'S2') throw new Error('network')
      return renamedTo(label, name)
    })
    vi.mocked(speakerSuggestionsApi.setStatus).mockResolvedValue({ ...suggestionFor('S1', '王小明'), status: 'applied' })
    await renderCompletedJob(unnamed)

    await user.click(await screen.findByRole('button', { name: '全部套用（2）' }))

    expect(await within(panel()).findByRole('button', { name: '改名：王小明' })).toBeInTheDocument()
    expect(speakerSuggestionsApi.setStatus).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('group', { name: '講者 2 可能是 李大華' })).toBeInTheDocument()
    expect(await screen.findByText('套用失敗：講者 2')).toBeInTheDocument()
  })

  it('does not suggest anything for a speaker the user already named, or a suggestion already dealt with', async () => {
    stubDesktopLayout()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([
      suggestionFor('S1', '王小明'), // S1 is already 主持人
      { ...suggestionFor('S2', '李大華'), status: 'dismissed' },
    ])
    await renderCompletedJob(multiSpeakerTranscript)
    await screen.findByRole('list', { name: '講者' })

    await waitFor(() => expect(speakerSuggestionsApi.list).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: /可能是/ })).not.toBeInTheDocument()
  })

  it('suggests inside the Source Sheet too (narrow viewport)', async () => {
    const user = userEvent.setup()
    vi.mocked(speakerSuggestionsApi.list).mockResolvedValue([suggestionFor('S2', '李大華')])
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(screen.getByRole('button', { name: '來源' }))

    expect(await within(await screen.findByRole('dialog')).findByRole('group', { name: '講者 2 可能是 李大華' })).toBeInTheDocument()
  })
})

describe('JobDetailPage renaming a speaker (COMPLETED, desktop layout)', () => {
  const panel = () => screen.getByRole('list', { name: '講者' })

  async function startRenaming(currentName: string) {
    const user = userEvent.setup()
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)
    await user.click(within(panel()).getByRole('button', { name: `改名：${currentName}` }))
    return { user, input: within(panel()).getByRole('textbox', { name: '講者名稱' }) }
  }

  it('renames a speaker in place, everywhere the name is shown, and marks the summary as possibly 過時', async () => {
    vi.mocked(transcriptApi.renameSpeaker).mockResolvedValue({
      speaker: { label: 'S2', displayName: '王小明', displayOrder: 2 },
      revision: 1,
    })
    const { user, input } = await startRenaming('講者 2')
    expect(input).toHaveValue('講者 2')

    await user.clear(input)
    await user.type(input, '王小明{Enter}')

    expect(transcriptApi.renameSpeaker).toHaveBeenCalledWith('job-1', 'S2', '王小明')
    expect(await within(panel()).findByRole('button', { name: '改名：王小明' })).toBeInTheDocument()
    expect(screen.getByText('大家好').closest('[data-segment-index]')).toHaveTextContent('王小明：大家好')
    expect(screen.getByText('逐字稿已修改，摘要與章節可能過時')).toBeInTheDocument()
  })

  it('restores the default name when the name is cleared', async () => {
    vi.mocked(transcriptApi.renameSpeaker).mockResolvedValue({
      speaker: { label: 'S1', displayName: '講者 1', displayOrder: 1 },
      revision: 1,
    })
    const { user, input } = await startRenaming('主持人')

    await user.clear(input)
    await user.keyboard('{Enter}')

    expect(transcriptApi.renameSpeaker).toHaveBeenCalledWith('job-1', 'S1', '')
    expect(await within(panel()).findByRole('button', { name: '改名：講者 1' })).toBeInTheDocument()
  })

  it('cancels on Escape without saving', async () => {
    const { user, input } = await startRenaming('講者 2')

    await user.type(input, '改到一半{Escape}')

    expect(transcriptApi.renameSpeaker).not.toHaveBeenCalled()
    expect(within(panel()).getByRole('button', { name: '改名：講者 2' })).toBeInTheDocument()
  })

  it('does not send anything when Enter is pressed without a change', async () => {
    const { user } = await startRenaming('講者 2')

    await user.keyboard('{Enter}')

    expect(transcriptApi.renameSpeaker).not.toHaveBeenCalled()
    expect(within(panel()).queryByRole('textbox', { name: '講者名稱' })).not.toBeInTheDocument()
  })

  it('cancels a rename on Escape inside the Source Sheet without closing the Sheet (narrow viewport)', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(multiSpeakerTranscript)
    await user.click(screen.getByRole('button', { name: '來源' }))
    const sheet = await screen.findByRole('dialog')

    await user.click(within(sheet).getByRole('button', { name: '改名：講者 2' }))
    await user.keyboard('{Escape}')

    expect(within(sheet).queryByRole('textbox', { name: '講者名稱' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps what the user typed and says so when saving fails', async () => {
    vi.mocked(transcriptApi.renameSpeaker).mockRejectedValue(new Error('network'))
    const { user, input } = await startRenaming('講者 2')

    await user.clear(input)
    await user.type(input, '王小明{Enter}')

    expect(await screen.findByText('改名失敗')).toBeInTheDocument()
    expect(input).toHaveValue('王小明')
  })
})

describe("JobDetailPage changing a segment's speaker (COMPLETED, desktop layout)", () => {
  const segmentRow = (text: string) => screen.getByText(text).closest('[data-segment-index]') as HTMLElement
  const speakerPanel = () => screen.queryByRole('list', { name: '講者' })

  async function openSpeakerMenu(transcript: Transcript, segmentText: string) {
    const user = userEvent.setup()
    stubDesktopLayout()
    await renderCompletedJob(transcript)
    await user.click(within(segmentRow(segmentText)).getByRole('button', { name: '改講者' }))
    return { user, menu: await screen.findByRole('menu') }
  }

  it('offers the speakers who have segments, marking the current one, and a way to add a speaker', async () => {
    const { menu } = await openSpeakerMenu(multiSpeakerTranscript, '今天請到來賓')

    const choices = within(menu).getAllByRole('menuitemradio')
    expect(choices.map((choice) => choice.textContent)).toEqual(['主持人', '講者 2'])
    expect(choices[0]).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitem', { name: '新增講者…' })).toBeInTheDocument()
  })

  it('gives the segment to the chosen speaker and marks the summary as possibly 過時', async () => {
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...multiSpeakerTranscript.segments[1], speakerLabel: 'S2' },
      speakers: multiSpeakerTranscript.speakers,
      revision: 1,
    })
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '今天請到來賓')

    await user.click(within(menu).getByRole('menuitemradio', { name: '講者 2' }))

    expect(transcriptApi.assignSegmentSpeaker).toHaveBeenCalledWith('job-1', 'seg-d2', { speakerLabel: 'S2' })
    await waitFor(() => expect(segmentRow('今天請到來賓')).toHaveTextContent('講者 2：今天請到來賓'))
    expect(screen.getByText('逐字稿已修改，摘要與章節可能過時')).toBeInTheDocument()
  })

  it("opens the same menu from the speaker's name at the start of a turn", async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    await user.click(within(segmentRow('大家好')).getByRole('button', { name: '改講者：講者 2' }))

    expect(within(await screen.findByRole('menu')).getAllByRole('menuitemradio')).toHaveLength(2)
  })

  it('does not send anything when the current speaker is chosen', async () => {
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '今天請到來賓')

    await user.click(within(menu).getByRole('menuitemradio', { name: '主持人' }))

    expect(transcriptApi.assignSegmentSpeaker).not.toHaveBeenCalled()
  })

  it('adds a new speaker, with a name, for the segment', async () => {
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...multiSpeakerTranscript.segments[3], speakerLabel: 'S4' },
      speakers: [...multiSpeakerTranscript.speakers, { label: 'S4', displayName: '李大華', displayOrder: 4 }],
      revision: 1,
    })
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '先聊聊近況')

    await user.click(within(menu).getByRole('menuitem', { name: '新增講者…' }))
    await user.type(within(segmentRow('先聊聊近況')).getByRole('textbox', { name: '新講者名稱' }), '李大華{Enter}')

    expect(transcriptApi.assignSegmentSpeaker).toHaveBeenCalledWith('job-1', 'seg-d4', { newSpeaker: { name: '李大華' } })
    expect(await within(speakerPanel()!).findByRole('button', { name: '改名：李大華' })).toBeInTheDocument()
  })

  it('shows the speakers as soon as a single-speaker recording gets a second one', async () => {
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...soloTranscript.segments[2], speakerLabel: 'S2' },
      speakers: [...soloTranscript.speakers, { label: 'S2', displayName: '講者 2', displayOrder: 2 }],
      revision: 1,
    })
    const { user, menu } = await openSpeakerMenu(soloTranscript, '大家好')
    expect(speakerPanel()).not.toBeInTheDocument()

    await user.click(within(menu).getByRole('menuitem', { name: '新增講者…' }))
    await user.keyboard('{Enter}')

    expect(transcriptApi.assignSegmentSpeaker).toHaveBeenCalledWith('job-1', 'seg-d3', { newSpeaker: { name: '' } })
    expect(await screen.findByRole('list', { name: '講者' })).toBeInTheDocument()
    expect(segmentRow('大家好')).toHaveTextContent('講者 2：大家好')
  })

  it('shows both speakers when a transcript from before speaker separation gets its first new speaker', async () => {
    // Such a transcript has no speakers at all; the backend gives the other segments to a new 講者 1.
    const oldTranscript: Transcript = {
      ...soloTranscript,
      segments: soloTranscript.segments.map((segment) => ({ ...segment, speakerLabel: null })),
      speakers: [],
    }
    const speakers = [
      { label: 'S1', displayName: '講者 1', displayOrder: 1 },
      { label: 'S2', displayName: '講者 2', displayOrder: 2 },
    ]
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...oldTranscript.segments[2], speakerLabel: 'S2' },
      speakers,
      revision: 1,
    })
    const { user, menu } = await openSpeakerMenu(oldTranscript, '大家好')
    vi.mocked(transcriptApi.get).mockResolvedValue({
      ...oldTranscript,
      revision: 1,
      segments: oldTranscript.segments.map((segment, i) => ({ ...segment, speakerLabel: i === 2 ? 'S2' : 'S1' })),
      speakers,
    })

    await user.click(within(menu).getByRole('menuitem', { name: '新增講者…' }))
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('list', { name: '講者' })).toBeInTheDocument()
    expect(segmentRow('歡迎收聽')).toHaveTextContent('講者 1：歡迎收聽')
    expect(segmentRow('大家好')).toHaveTextContent('講者 2：大家好')
  })

  it('cancels adding a speaker on Escape', async () => {
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '先聊聊近況')

    await user.click(within(menu).getByRole('menuitem', { name: '新增講者…' }))
    await user.keyboard('王{Escape}')

    expect(screen.queryByRole('textbox', { name: '新講者名稱' })).not.toBeInTheDocument()
    expect(transcriptApi.assignSegmentSpeaker).not.toHaveBeenCalled()
  })

  it('says so when changing the speaker fails', async () => {
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockRejectedValue(new Error('network'))
    const { user, menu } = await openSpeakerMenu(multiSpeakerTranscript, '今天請到來賓')

    await user.click(within(menu).getByRole('menuitemradio', { name: '講者 2' }))

    expect(await screen.findByText('改講者失敗')).toBeInTheDocument()
  })
})

describe('JobDetailPage speaker stats (講者數據, COMPLETED, desktop layout)', () => {
  const statsTable = () => screen.getByRole('table', { name: '每位講者的發言' })
  const rowOf = (name: string) => within(statsTable()).getByRole('row', { name: new RegExp(`^${name}`) })

  it('shows a tile only when there are two or more speakers', async () => {
    stubDesktopLayout()
    await renderCompletedJob(soloTranscript)

    await screen.findByRole('list', { name: 'AI 工具' })
    expect(screen.queryByRole('button', { name: '講者數據' })).not.toBeInTheDocument()
  })

  it('lists each speaker’s talk time, share, turns and longest turn, and the turn changes', async () => {
    stubDesktopLayout()
    await renderCompletedJob(multiSpeakerTranscript)

    expect(await screen.findByRole('button', { name: '講者數據' })).toHaveAccessibleDescription('2 位講者 · 講最多：主持人')
    await openStudioTool('講者數據')

    // 主持人: 0–4 (one turn) and 6–8; 講者 2: 4–6. 講者 3 has no segments left and isn't listed.
    expect(within(rowOf('主持人')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['00:06', '75%', '2', '00:04', '00:03'])
    expect(within(rowOf('講者 2')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['00:02', '25%', '1', '00:02', '00:02'])
    expect(within(statsTable()).queryByRole('row', { name: /講者 3/ })).not.toBeInTheDocument()
    expect(screen.getByText('換人 2 次')).toBeInTheDocument()
  })

  it('works the numbers out again when a segment is given to another speaker', async () => {
    const user = userEvent.setup()
    stubDesktopLayout()
    vi.mocked(transcriptApi.assignSegmentSpeaker).mockResolvedValue({
      segment: { ...multiSpeakerTranscript.segments[1], speakerLabel: 'S2' },
      speakers: multiSpeakerTranscript.speakers,
      revision: 1,
    })
    await renderCompletedJob(multiSpeakerTranscript)
    await openStudioTool('講者數據')

    const row = screen.getByText('今天請到來賓').closest('[data-segment-index]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: '改講者' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitemradio', { name: '講者 2' }))

    await waitFor(() =>
      expect(within(rowOf('講者 2')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['00:04', '50%', '1', '00:04', '00:04']))
  })

  describe('questions and interruptions judged by AI (估計)', () => {
    const analysed: SpeakerInsights = {
      ...noInsights,
      status: 'COMPLETED',
      sourceRevision: 0,
      model: 'qwen3:14b',
      completedAt: '2026-10-03T10:00:00Z',
      items: [
        { kind: 'question', speakerLabel: 'S1', interruptedLabel: null, startTime: 2, text: '今天請到來賓' },
        { kind: 'interruption', speakerLabel: 'S2', interruptedLabel: 'S1', startTime: 4, text: '大家好' },
      ],
    }

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('analyses on request, then lists the questions and possible interruptions with who and when', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.request).mockResolvedValue({ ...noInsights, status: 'GENERATING' })
      await renderCompletedJob(multiSpeakerTranscript)
      await openStudioTool('講者數據')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      await user.click(screen.getByRole('button', { name: '分析問題與打斷' }))
      expect(speakerInsightsApi.request).toHaveBeenCalledWith('job-1')
      expect(screen.getByText('分析中…')).toBeInTheDocument()

      vi.mocked(speakerInsightsApi.get).mockResolvedValue(analysed)
      await vi.advanceTimersByTimeAsync(3000)

      const questions = await screen.findByRole('list', { name: '提出的問題' })
      expect(within(questions).getByRole('listitem')).toHaveTextContent('主持人')
      expect(within(questions).getByRole('listitem')).toHaveTextContent('今天請到來賓')
      const interruptions = screen.getByRole('list', { name: '可能的打斷' })
      expect(within(interruptions).getByRole('listitem')).toHaveTextContent('講者 2 打斷了 主持人')
      expect(screen.getByText(/AI 估計/)).toBeInTheDocument()
    })

    it('plays from where a question was asked', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.get).mockResolvedValue(analysed)
      await renderCompletedJob(multiSpeakerTranscript)
      await openStudioTool('講者數據')

      const questions = await screen.findByRole('list', { name: '提出的問題' })
      fireEvent.click(within(questions).getByRole('button', { name: '0:02' }))

      expect((document.querySelector('audio') as HTMLMediaElement).currentTime).toBe(2)
    })

    it('says the analysis may be out of date once the transcript has changed', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.get).mockResolvedValue({ ...analysed, sourceRevision: 0 })
      await renderCompletedJob({ ...multiSpeakerTranscript, revision: 2 })
      await openStudioTool('講者數據')

      expect(await screen.findByText('逐字稿已修改，這份分析可能過時')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '重新分析' })).toBeInTheDocument()
    })

    it('offers only one way to try again when a re-analysis of out-of-date results failed', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.get).mockResolvedValue({ ...analysed, status: 'FAILED', failureReason: '分析失敗，請再試一次' })
      await renderCompletedJob({ ...multiSpeakerTranscript, revision: 2 })
      await openStudioTool('講者數據')

      expect(await screen.findByRole('button', { name: '再分析一次' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '重新分析' })).not.toBeInTheDocument()
      expect(screen.getByRole('list', { name: '提出的問題' })).toBeInTheDocument() // the earlier results stay
    })

    it('shows why it failed and offers to try again', async () => {
      stubDesktopLayout()
      vi.mocked(speakerInsightsApi.get).mockResolvedValue({ ...noInsights, status: 'FAILED', failureReason: '模型回傳的格式不正確，請再分析一次' })
      await renderCompletedJob(multiSpeakerTranscript)
      await openStudioTool('講者數據')

      expect(await screen.findByText('模型回傳的格式不正確，請再分析一次')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '再分析一次' })).toBeInTheDocument()
    })
  })

  it('marks a speaker who talks very little', async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...multiSpeakerTranscript,
      segments: [
        { id: 'q1', startTime: 0, endTime: 100, speakerLabel: 'S1', text: '很長的開場', originalText: '很長的開場' },
        { id: 'q2', startTime: 100, endTime: 105, speakerLabel: 'S2', text: '好', originalText: '好' },
      ],
    })
    await openStudioTool('講者數據')

    expect(within(rowOf('講者 2')).getByText('發言很少')).toBeInTheDocument()
    expect(within(rowOf('主持人')).queryByText('發言很少')).not.toBeInTheDocument()
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

// jsdom doesn't navigate on link clicks: capture what would have been downloaded.
function captureDownloads() {
  const blobsByUrl = new Map<string, Blob>()
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:export-${blobsByUrl.size}`
    blobsByUrl.set(url, blob as Blob)
    return url
  })
  const downloads: { fileName: string; blob: Blob | undefined }[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ fileName: this.download, blob: blobsByUrl.get(this.href) })
  })
  return downloads
}

describe('JobDetailPage export menu', () => {
  it('is offered in the workspace of a COMPLETED job', async () => {
    await renderCompletedJob()

    expect(screen.getByRole('button', { name: '匯出' })).toBeInTheDocument()
  })

  it('is not offered while the job is still processing', async () => {
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'SUMMARIZING' })
    renderJobDetail()

    await screen.findByText('處理中,完成後這裡會自動更新逐字稿與摘要...')
    expect(screen.queryByRole('button', { name: '匯出' })).not.toBeInTheDocument()
  })

  it('downloads the transcript as SRT subtitles named after the uploaded file', async () => {
    const user = userEvent.setup()
    const downloads = captureDownloads()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載字幕（SRT）' }))

    expect(downloads).toHaveLength(1)
    expect(downloads[0].fileName).toBe('interview.srt')
    expect(await downloads[0].blob?.text()).toContain('1\n00:00:05,000 --> 00:00:08,000\n第一句\n')
  })

  it.each([
    ['下載字幕（VTT）', 'interview.vtt', 'WEBVTT\n\n00:00:05.000 --> 00:00:08.000\n第一句\n'],
    ['下載逐字稿（TXT，純文字）', 'interview.txt', '第一句\n第二句\n第三句\n'],
    ['下載逐字稿（TXT，含時間戳）', 'interview-含時間戳.txt', '[00:05] 第一句\n[00:08] 第二句\n'],
  ])('%s downloads %s', async (item, fileName, expectedContent) => {
    const user = userEvent.setup()
    const downloads = captureDownloads()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: item }))

    expect(downloads.map((download) => download.fileName)).toEqual([fileName])
    expect(await downloads[0].blob?.text()).toContain(expectedContent)
  })

  it('copies the transcript as plain text and confirms it', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '複製逐字稿' }))

    expect(await navigator.clipboard.readText()).toBe('第一句\n第二句\n第三句\n')
    expect(await screen.findByText('已複製逐字稿')).toBeInTheDocument()
  })

  it('copies the summary and confirms it', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '複製摘要' }))

    expect(await navigator.clipboard.readText()).toBe('這是摘要內容')
    expect(await screen.findByText('已複製摘要')).toBeInTheDocument()
  })

  it('tells the user when copying fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '複製摘要' }))

    expect(await screen.findByText('複製失敗')).toBeInTheDocument()
  })

  it('downloads a Markdown report, leaving the Q&A history out unless the user opts in', async () => {
    const user = userEvent.setup()
    const downloads = captureDownloads()
    await renderGappedTranscriptOnDesktop([
      { question: '第三句在說什麼?', answer: '在說第三句', sourceTimestamps: [13], createdAt: '2026-01-01T00:00:00Z', modelProvider: null, model: null },
    ])

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載報告（Markdown）' }))

    expect(downloads[0].fileName).toBe('interview-報告.md')
    const report = await downloads[0].blob?.text()
    expect(report).toContain('## 摘要\n\n這是摘要內容\n')
    expect(report).toContain('## 逐字稿\n\n[00:05] 第一句\n')
    expect(report).not.toContain('## 問答紀錄')

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: '報告包含問答紀錄' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載報告（Markdown）' }))

    expect(await downloads[1].blob?.text()).toContain('## 問答紀錄\n\n### 第三句在說什麼?\n\n在說第三句\n\n引用：[00:13]\n')
  })

  it('downloads the notes on their own, and puts them in the report when asked', async () => {
    const user = userEvent.setup()
    const downloads = captureDownloads()
    vi.mocked(notesApi.list).mockResolvedValue([
      { noteId: 'n1', jobId: 'job-1', timeSeconds: 8, text: '第二句要確認', source: 'manual', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ])
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載筆記（Markdown）' }))

    expect(downloads[0].fileName).toBe('interview-筆記.md')
    expect(await downloads[0].blob?.text()).toContain('- [00:08] 第二句要確認\n')

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載報告（Markdown）' }))
    expect(await downloads[1].blob?.text()).not.toContain('## 筆記')

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: '報告包含筆記' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載報告（Markdown）' }))
    expect(await downloads[2].blob?.text()).toContain('## 筆記\n\n- [00:08] 第二句要確認\n')
  })

  it('offers no notes download while there are no notes', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(screen.getByRole('button', { name: '匯出' }))

    expect(await screen.findByRole('menuitem', { name: '下載筆記（Markdown）' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('downloads the original media file through an attachment URL from the Gateway', async () => {
    const user = userEvent.setup()
    const opened: { href: string; download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      opened.push({ href: this.href, download: this.download })
    })
    await renderGappedTranscriptOnDesktop()
    vi.mocked(jobsApi.getMediaUrl).mockResolvedValueOnce({
      downloadUrl: 'https://media.example.com/uploads/interview.mp3?response-content-disposition=attachment',
      expiresAt: '2026-01-01T01:00:00Z',
    })

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載原始檔' }))

    expect(jobsApi.getMediaUrl).toHaveBeenLastCalledWith('job-1', { download: true })
    await waitFor(() =>
      expect(opened).toEqual([
        { href: 'https://media.example.com/uploads/interview.mp3?response-content-disposition=attachment', download: '' },
      ]),
    )
  })
})

describe('JobDetailPage segment editing (COMPLETED, desktop layout)', () => {
  function editButtonFor(text: string) {
    const row = screen.getByText(text).closest('[data-segment-index]')
    if (!(row instanceof HTMLElement)) throw new Error(`no segment row for ${text}`)
    return within(row).getByRole('button', { name: '編輯片段' })
  }

  it('edits a segment in place and saves it on Enter', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { id: 'seg-3', startTime: 8, endTime: 10, speakerLabel: null, text: '第二句改好了', originalText: '第二句' },
      revision: 1,
    })
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    expect(editor).toHaveValue('第二句')
    await user.clear(editor)
    await user.type(editor, '第二句改好了{Enter}')

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-3', '第二句改好了')
    expect(await screen.findByText('第二句改好了')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
  })

  it('cancels editing on Escape without saving', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '亂打{Escape}')

    expect(transcriptApi.updateSegmentText).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
    expect(screen.getByText('第二句')).toBeInTheDocument()
  })

  it('keeps what the user typed and says so when saving fails', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockRejectedValue(new Error('network'))
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    await user.clear(editor)
    await user.type(editor, '沒存到{Enter}')

    expect(await screen.findByText('儲存失敗')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '編輯片段文字' })).toHaveValue('沒存到')
  })

  it('shows that it is saving and blocks further input meanwhile', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockReturnValue(new Promise(() => {}))
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '改{Enter}')

    expect(screen.getByRole('textbox', { name: '編輯片段文字' })).toBeDisabled()
    expect(screen.getByText('儲存中…')).toBeInTheDocument()
  })

  it('saves and cancels from the buttons under the editor too (touch keyboards have no Esc)', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { id: 'seg-3', startTime: 8, endTime: 10, speakerLabel: null, text: '第二句改好了', originalText: '第二句' },
      revision: 1,
    })
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '亂打')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(transcriptApi.updateSegmentText).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()

    await user.click(editButtonFor('第二句'))
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    await user.clear(editor)
    await user.type(editor, '第二句改好了')
    await user.click(screen.getByRole('button', { name: '儲存' }))
    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-3', '第二句改好了')
    expect(await screen.findByText('第二句改好了')).toBeInTheDocument()
  })

  it('pauses auto-follow while editing, without pausing playback', async () => {
    const user = userEvent.setup()
    const media = await renderGappedTranscriptOnDesktop()
    playTo(media, 9)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause')

    await user.click(editButtonFor('第一句'))

    expect(screen.getByRole('button', { name: '回到播放位置' })).toBeInTheDocument()
    expect(pause).not.toHaveBeenCalled()
  })

  it('cancels an edit on Escape inside the Source Sheet without closing the Sheet (narrow viewport)', async () => {
    const user = userEvent.setup()
    await renderCompletedJob(gappedTranscript)
    await user.click(screen.getByRole('button', { name: '來源' }))
    await screen.findByText('第二句')

    await user.click(editButtonFor('第二句'))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('第二句')).toBeInTheDocument()
  })

  it('does not close the editor of another segment when an earlier save finishes', async () => {
    const user = userEvent.setup()
    let finishFirstSave: () => void = () => {}
    vi.mocked(transcriptApi.updateSegmentText).mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirstSave = () =>
          resolve({
            segment: { id: 'seg-2', startTime: 5, endTime: 8, speakerLabel: null, text: '第一句改', originalText: '第一句' },
            revision: 1,
          })
      }),
    )
    await renderGappedTranscriptOnDesktop()
    await user.click(editButtonFor('第一句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '改{Enter}')

    await user.click(editButtonFor('第三句'))
    finishFirstSave()

    expect(await screen.findByText('第一句改')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '編輯片段文字' })).toHaveValue('第三句')
  })

  it('does not send anything when Enter is pressed without a change', async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '{Enter}')

    expect(transcriptApi.updateSegmentText).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: '編輯片段文字' })).not.toBeInTheDocument()
  })

  it("gives keyboard focus back to the segment's edit button when the editor closes", async () => {
    const user = userEvent.setup()
    await renderGappedTranscriptOnDesktop()

    await user.click(editButtonFor('第二句'))
    await user.keyboard('{Escape}')

    expect(editButtonFor('第二句')).toHaveFocus()
  })

  it('keeps the search counter within the matches that remain after an edit', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { id: 'seg-4', startTime: 12, endTime: 15, speakerLabel: null, text: '最後一段', originalText: '第三句' },
      revision: 1,
    })
    await renderGappedTranscriptOnDesktop()
    await user.type(searchbox(), '句')
    await user.click(screen.getByRole('button', { name: '上一個符合結果' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()

    // The search highlights split 「第三句」 into several elements, so pick the third segment's button.
    await user.click(screen.getAllByRole('button', { name: '編輯片段' })[2])
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    await user.clear(editor)
    await user.type(editor, '最後一段{Enter}')

    expect(await screen.findByText('2 / 2')).toBeInTheDocument()
  })
})

describe('JobDetailPage edited and cleared segments (COMPLETED, desktop layout)', () => {
  const editedTranscript: Transcript = {
    ...gappedTranscript,
    revision: 2,
    segments: [
      { id: 'seg-a', startTime: 5, endTime: 8, speakerLabel: null, text: '強風豪雨', originalText: '強風好雨' },
      { id: 'seg-b', startTime: 8, endTime: 10, speakerLabel: null, text: '', originalText: '請不吝點讚訂閱' },
      { id: 'seg-c', startTime: 12, endTime: 15, speakerLabel: null, text: '沒改過', originalText: '沒改過' },
    ],
  }

  async function renderEdited() {
    stubDesktopLayout()
    await renderCompletedJob(editedTranscript)
    await screen.findByText('強風豪雨')
  }

  function row(index: number) {
    const element = document.querySelector(`[data-segment-index="${index}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no segment row ${index}`)
    return within(element)
  }

  it('marks a segment whose text differs from the original text, and only that one', async () => {
    await renderEdited()

    expect(row(0).getByText('已編輯')).toBeInTheDocument()
    expect(row(2).queryByText('已編輯')).not.toBeInTheDocument()
    expect(row(2).queryByRole('button', { name: '還原成原始文字' })).not.toBeInTheDocument()
  })

  it('restores an edited segment to its original text', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...editedTranscript.segments[0], text: '強風好雨' },
      revision: 3,
    })
    await renderEdited()

    await user.click(row(0).getByRole('button', { name: '還原成原始文字' }))

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-a', '強風好雨')
    expect(await screen.findByText('強風好雨')).toBeInTheDocument()
    expect(row(0).queryByText('已編輯')).not.toBeInTheDocument()
  })

  it('shows a cleared segment as a faint row that can be restored', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...editedTranscript.segments[1], text: '請不吝點讚訂閱' },
      revision: 3,
    })
    await renderEdited()

    expect(row(1).getByText('已清空')).toBeInTheDocument()
    expect(screen.queryByText('請不吝點讚訂閱')).not.toBeInTheDocument()

    await user.click(row(1).getByRole('button', { name: '還原：請不吝點讚訂閱' }))

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-b', '請不吝點讚訂閱')
    expect(await screen.findByText('請不吝點讚訂閱')).toBeInTheDocument()
  })

  it('does not find a cleared segment when searching', async () => {
    const user = userEvent.setup()
    await renderEdited()

    await user.type(searchbox(), '點讚')

    expect(screen.getByText('沒有符合的結果')).toBeInTheDocument()
  })

  it('clears a segment when its text is saved empty', async () => {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...editedTranscript.segments[2], text: '' },
      revision: 3,
    })
    await renderEdited()

    await user.click(row(2).getByRole('button', { name: '編輯片段' }))
    await user.clear(screen.getByRole('textbox', { name: '編輯片段文字' }))
    await user.keyboard('{Enter}')

    expect(transcriptApi.updateSegmentText).toHaveBeenCalledWith('job-1', 'seg-c', '')
    expect(await row(2).findByText('已清空')).toBeInTheDocument()
  })

  it('still highlights a cleared segment when playback is inside it', async () => {
    await renderEdited()

    playTo(renderedMediaElement(), 9)

    expect(currentSegmentText()).toContain('已清空')
  })

  it('gives focus back to the segment and blocks a second click while restoring', async () => {
    const user = userEvent.setup()
    let finishRestore: () => void = () => {}
    vi.mocked(transcriptApi.updateSegmentText).mockReturnValue(
      new Promise((resolve) => {
        finishRestore = () => resolve({ segment: { ...editedTranscript.segments[0], text: '強風好雨' }, revision: 3 })
      }),
    )
    await renderEdited()

    const restore = row(0).getByRole('button', { name: '還原成原始文字' })
    await user.click(restore)
    expect(restore).toBeDisabled()
    finishRestore()

    await screen.findByText('強風好雨')
    expect(row(0).getByRole('button', { name: '編輯片段' })).toHaveFocus()
    expect(transcriptApi.updateSegmentText).toHaveBeenCalledTimes(1)
  })

  it('offers no restore for a segment whose original text was empty to begin with', async () => {
    stubDesktopLayout()
    await renderCompletedJob({
      ...editedTranscript,
      segments: [{ id: 'seg-z', startTime: 5, endTime: 8, speakerLabel: null, text: '', originalText: '' }],
    })
    await screen.findByText('已清空')

    expect(row(0).queryByRole('button', { name: /^還原/ })).not.toBeInTheDocument()
  })
})

describe('JobDetailPage 過時 summary and chapters (COMPLETED, desktop layout)', () => {
  const staleNotice = '逐字稿已修改，摘要與章節可能過時'

  async function editFirstSegment() {
    const user = userEvent.setup()
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { ...gappedTranscript.segments[0], text: '第一句改' },
      revision: 1,
    })
    const row = screen.getByText('第一句').closest('[data-segment-index]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: '編輯片段' }))
    await user.type(screen.getByRole('textbox', { name: '編輯片段文字' }), '改{Enter}')
    await screen.findByText('第一句改')
    return user
  }

  it('shows no notice while the summary matches the transcript', async () => {
    await renderGappedTranscriptOnDesktop()

    expect(screen.queryByText(staleNotice)).not.toBeInTheDocument()
  })

  it('flags the summary and chapters as 過時 as soon as an edit is saved', async () => {
    await renderGappedTranscriptOnDesktop()

    await editFirstSegment()

    expect(screen.getByText(staleNotice)).toBeInTheDocument()
  })

  it('carries the 過時 note into the Markdown report', async () => {
    const downloads: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      downloads.push(blob as Blob)
      return 'blob:report'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await renderGappedTranscriptOnDesktop()
    const user = await editFirstSegment()

    await user.click(screen.getByRole('button', { name: '匯出' }))
    await user.click(await screen.findByRole('menuitem', { name: '下載報告（Markdown）' }))

    expect(await downloads[0].text()).toContain('> 逐字稿在摘要產生後有修改，摘要與章節可能過時')
  })
})

describe('JobDetailPage regenerating the summary and chapters (COMPLETED, desktop layout)', () => {
  const staleTranscript: Transcript = { ...gappedTranscript, revision: 1 }
  const fresh: Summary = { ...mockSummary, summaryText: '重新產生的摘要', sourceRevision: 1 }
  const running: Summary = { ...mockSummary, regenerationStatus: 'RUNNING' }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function renderStale(summary: Summary = mockSummary) {
    stubDesktopLayout()
    vi.mocked(jobsApi.get).mockResolvedValue({ ...baseJob, status: 'COMPLETED' })
    vi.mocked(transcriptApi.get).mockResolvedValue(staleTranscript)
    vi.mocked(summaryApi.get).mockResolvedValue(summary)
    vi.mocked(chapterApi.list).mockResolvedValue(mockChapters)
    vi.mocked(qaApi.history).mockResolvedValue([])
    renderJobDetail()
    await screen.findByText('第一句')
    await openStudioTool('AI 摘要')
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  }

  it('offers no regeneration while the summary is up to date', async () => {
    stubDesktopLayout()
    await renderCompletedJob(gappedTranscript)

    expect(screen.queryByRole('button', { name: '重新產生摘要與章節' })).not.toBeInTheDocument()
  })

  it('regenerates in the background and swaps in the new summary and chapters when done', async () => {
    const user = await renderStale()
    vi.mocked(summaryApi.regenerate).mockResolvedValue(running)
    vi.mocked(summaryApi.get).mockResolvedValue(fresh)
    vi.mocked(chapterApi.list).mockResolvedValue([{ id: 'ch-9', jobId: 'job-1', title: '新章節', startTime: 5, sequenceNo: 0 }])

    await user.click(await screen.findByRole('button', { name: '重新產生摘要與章節' }))

    expect(summaryApi.regenerate).toHaveBeenCalledWith('job-1')
    expect(screen.getByText('重新產生中…')).toBeInTheDocument()
    expect(screen.getByText('這是摘要內容', { selector: 'p' })).toBeInTheDocument() // the old content stays meanwhile

    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('重新產生的摘要', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText('逐字稿已修改，摘要與章節可能過時')).not.toBeInTheDocument()
    await openStudioTool('章節')
    expect(screen.getByText('新章節')).toBeInTheDocument()
  })

  it('keeps the old content and says so when the regeneration fails', async () => {
    const user = await renderStale()
    vi.mocked(summaryApi.regenerate).mockResolvedValue(running)
    vi.mocked(summaryApi.get).mockResolvedValue({ ...mockSummary, regenerationStatus: 'FAILED' })

    await user.click(await screen.findByRole('button', { name: '重新產生摘要與章節' }))
    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('重新產生失敗')).toBeInTheDocument()
    expect(screen.getByText('這是摘要內容', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新產生摘要與章節' })).toBeEnabled()
  })

  it('shows the calls a failed regeneration made in the usage, too', async () => {
    const user = await renderStale()
    vi.mocked(summaryApi.regenerate).mockResolvedValue(running)
    vi.mocked(summaryApi.get).mockResolvedValue({ ...mockSummary, regenerationStatus: 'FAILED' })
    vi.mocked(usageApi.getJobUsage).mockResolvedValue({
      records: [{
        kind: 'llm', feature: 'regenerated_summary', provider: 'platform', model: 'Qwen/Qwen3.5-9B',
        keySource: 'platform', inputTokens: null, outputTokens: null, audioSeconds: null, succeeded: false,
        createdAt: '2026-09-26T02:05:00Z',
      }],
      totals: { inputTokens: 0, outputTokens: 0, audioSeconds: 0 },
    })

    await user.click(await screen.findByRole('button', { name: '重新產生摘要與章節' }))
    await vi.advanceTimersByTimeAsync(3000)

    await waitFor(() => expect(usageApi.getJobUsage).toHaveBeenCalledTimes(2))
    await openStudioTool('用量')
    expect(await within(screen.getByRole('list', { name: '依功能' })).findByText('重新產生摘要')).toBeInTheDocument()
  })

  it('keeps waiting for a regeneration that was already running when the page opened', async () => {
    await renderStale(running)
    vi.mocked(summaryApi.get).mockResolvedValue(fresh)

    expect(await screen.findByText('重新產生中…')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('重新產生的摘要')).toBeInTheDocument()
  })

  it('sends one request even when the button is clicked twice before it answers', async () => {
    const user = await renderStale()
    vi.mocked(summaryApi.regenerate).mockReturnValue(new Promise(() => {}))

    const button = await screen.findByRole('button', { name: '重新產生摘要與章節' })
    await user.click(button)
    await user.click(button)

    expect(summaryApi.regenerate).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
  })

  it('keeps the old chapters if reloading them after a regeneration fails', async () => {
    const user = await renderStale()
    vi.mocked(summaryApi.regenerate).mockResolvedValue(running)
    vi.mocked(summaryApi.get).mockResolvedValue(fresh)
    vi.mocked(chapterApi.list).mockRejectedValue(new Error('network'))

    await user.click(await screen.findByRole('button', { name: '重新產生摘要與章節' }))
    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('重新產生的摘要', { selector: 'p' })).toBeInTheDocument()
    await openStudioTool('章節')
    expect(screen.getByText('開場')).toBeInTheDocument()
  })
})

const doneQuiz: Quiz = {
  id: 'quiz-1',
  jobId: 'job-1',
  questionCount: 10,
  status: 'COMPLETED',
  failureReason: null,
  sourceRevision: 0,
  modelProvider: 'platform',
  model: 'Qwen/Qwen3.5-9B',
  requestedAt: '2026-09-26T06:00:00Z',
  completedAt: '2026-09-26T06:00:40Z',
  questions: null,
  bestCorrectCount: null,
}

describe('JobDetailPage quizzes (測驗)', () => {
  const quiz = (overrides: Partial<Quiz> = {}): Quiz => ({ ...doneQuiz, ...overrides })
  const generating = quiz({ status: 'GENERATING', modelProvider: null, model: null, completedAt: null })
  const quizCard = () => screen.getByRole('region', { name: '測驗' })

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function renderQuizzes() {
    stubDesktopLayout()
    await renderCompletedJob()
    await openStudioTool('測驗')
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  }

  it("lists the job's quizzes with their question count and model", async () => {
    vi.mocked(quizApi.list).mockResolvedValue([quiz({ id: 'quiz-2', questionCount: 20, model: 'gpt-5' }), quiz()])
    await renderQuizzes()

    const [newest, older] = await within(quizCard()).findAllByRole('listitem')
    expect(newest).toHaveTextContent('20 題')
    expect(newest).toHaveTextContent('由 AI 產生（模型：gpt-5）')
    expect(older).toHaveTextContent('10 題')
  })

  it('generates 10 questions unless another count is picked, and shows it once it is ready', async () => {
    const user = await renderQuizzes()
    expect(within(quizCard()).getByText('還沒有測驗')).toBeInTheDocument()
    expect(within(quizCard()).getByRole('combobox', { name: '題數' })).toHaveValue('10')
    vi.mocked(quizApi.request).mockResolvedValue(generating)

    await user.click(within(quizCard()).getByRole('button', { name: '產生測驗' }))

    expect(quizApi.request).toHaveBeenCalledWith('job-1', 10)
    expect(await within(quizCard()).findByText('產生中…')).toBeInTheDocument()

    vi.mocked(quizApi.list).mockResolvedValue([quiz()])
    vi.mocked(usageApi.getJobUsage).mockClear()
    await vi.advanceTimersByTimeAsync(3000)

    expect(await within(quizCard()).findByTitle('模型：Qwen/Qwen3.5-9B')).toBeInTheDocument()
    expect(within(quizCard()).queryByText('產生中…')).not.toBeInTheDocument()
    expect(usageApi.getJobUsage).toHaveBeenCalled() // generating it used the model
  })

  it('asks for the picked number of questions', async () => {
    const user = await renderQuizzes()
    vi.mocked(quizApi.request).mockResolvedValue({ ...generating, questionCount: 20 })

    await user.selectOptions(within(quizCard()).getByRole('combobox', { name: '題數' }), '20')
    await user.click(within(quizCard()).getByRole('button', { name: '產生測驗' }))

    expect(quizApi.request).toHaveBeenCalledWith('job-1', 20)
  })

  it('keeps asking every 3 seconds while a quiz is still being generated when the page opens', async () => {
    vi.mocked(quizApi.list).mockResolvedValue([generating])
    await renderQuizzes()
    await within(quizCard()).findByText('產生中…')
    const listed = vi.mocked(quizApi.list).mock.calls.length

    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)

    expect(vi.mocked(quizApi.list).mock.calls.length).toBe(listed + 2)
  })

  it('does not lose a just-requested quiz to a list that was asked for before it', async () => {
    vi.mocked(quizApi.list).mockResolvedValue([generating])
    const user = await renderQuizzes()
    await within(quizCard()).findByText('產生中…')
    let answerOldPoll: (quizzes: Quiz[]) => void = () => {}
    vi.mocked(quizApi.list).mockReturnValueOnce(new Promise((resolve) => (answerOldPoll = resolve)))
    await vi.advanceTimersByTimeAsync(3000) // a poll goes out…
    vi.mocked(quizApi.request).mockResolvedValue({ ...generating, id: 'quiz-new', questionCount: 20 })
    await user.selectOptions(within(quizCard()).getByRole('combobox', { name: '題數' }), '20')
    await user.click(within(quizCard()).getByRole('button', { name: '產生測驗' })) // …then a new quiz is requested

    await act(async () => answerOldPoll([quiz()])) // the old poll answers without the new quiz

    expect(within(quizCard()).getAllByRole('listitem')[0]).toHaveTextContent('20 題')
    vi.mocked(quizApi.list).mockResolvedValue([{ ...generating, id: 'quiz-new', questionCount: 20 }, quiz()])
    const listed = vi.mocked(quizApi.list).mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(vi.mocked(quizApi.list).mock.calls.length).toBe(listed + 1) // still waiting for the new one
  })

  it('shows when a finished quiz was made', async () => {
    vi.mocked(quizApi.list).mockResolvedValue([
      quiz({ requestedAt: '2026-09-26T06:00:00Z', completedAt: '2026-09-26T06:07:00Z' }),
    ])
    await renderQuizzes()

    const item = await within(quizCard()).findByRole('listitem')
    const made = new Date('2026-09-26T06:07:00Z')
    const pad = (value: number) => String(value).padStart(2, '0')
    expect(item).toHaveTextContent(`${pad(made.getHours())}:${pad(made.getMinutes())}`)
  })

  it('shows why a quiz failed and tries again with the same number of questions', async () => {
    vi.mocked(quizApi.list).mockResolvedValue([
      quiz({ status: 'FAILED', questionCount: 5, failureReason: '模型回傳的測驗格式不正確（應該要有 5 題），請再產生一次', model: null }),
    ])
    const user = await renderQuizzes()
    vi.mocked(quizApi.request).mockResolvedValue({ ...generating, id: 'quiz-3', questionCount: 5 })

    expect(await within(quizCard()).findByText('模型回傳的測驗格式不正確（應該要有 5 題），請再產生一次')).toBeInTheDocument()
    await user.click(within(quizCard()).getByRole('button', { name: '再試一次' }))

    expect(quizApi.request).toHaveBeenCalledWith('job-1', 5)
    expect(await within(quizCard()).findByText('產生中…')).toBeInTheDocument()
  })

  it('says why a quiz could not be requested', async () => {
    const user = await renderQuizzes()
    vi.mocked(quizApi.request).mockRejectedValue(new ApiError(503, { error: 'UNAVAILABLE', message: '暫時無法產生測驗，請稍後再試' }))

    await user.click(within(quizCard()).getByRole('button', { name: '產生測驗' }))

    expect(await screen.findByText('暫時無法產生測驗，請稍後再試')).toBeInTheDocument()
  })

  it('can be used on a phone, inside the Studio sheet', async () => {
    vi.mocked(quizApi.list).mockResolvedValue([quiz()])
    await renderCompletedJob()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByRole('button', { name: 'AI 工具' }))
    await openStudioTool('測驗')

    const card = await screen.findByRole('region', { name: '測驗' })
    expect(await within(card).findByRole('listitem')).toHaveTextContent('由 AI 產生（模型：Qwen/Qwen3.5-9B）')
  })
})

describe('JobDetailPage taking a quiz (作答)', () => {
  const questions: QuizQuestion[] = [
    {
      kind: 'multiple_choice',
      prompt: '這集主要在講什麼？',
      options: ['天氣', '預算', '旅遊', '音樂'],
      correctOption: 1,
      explanation: '開場就說今天談預算。',
      sourceTimestamps: [12],
    },
    {
      kind: 'true_false',
      prompt: '講者主張砍一成。',
      options: ['是', '否'],
      correctOption: 0,
      explanation: '他說要砍一成。',
      sourceTimestamps: [],
    },
  ]
  const completedQuiz: Quiz = { ...doneQuiz, questionCount: 2 }
  const attemptResult: QuizAttemptResult = {
    correctCount: 1,
    questionCount: 2,
    results: [
      { chosenOption: 1, correctOption: 1, correct: true, explanation: '開場就說今天談預算。' },
      { chosenOption: 1, correctOption: 0, correct: false, explanation: '他說要砍一成。' },
    ],
  }

  beforeEach(() => {
    vi.mocked(quizApi.list).mockResolvedValue([completedQuiz])
    vi.mocked(quizApi.get).mockResolvedValue({ ...completedQuiz, questions })
    vi.mocked(quizApi.submitAttempt).mockResolvedValue(attemptResult)
  })

  async function openQuiz() {
    stubDesktopLayout()
    await renderCompletedJob()
    const user = userEvent.setup()
    await openStudioTool('測驗')
    const card = await screen.findByRole('region', { name: '測驗' })
    await user.click(await within(card).findByRole('button', { name: '作答' }))
    return { user, dialog: await screen.findByRole('dialog') }
  }

  async function answerAll(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    await user.click(await within(dialog).findByRole('radio', { name: '預算' }))
    await user.click(within(dialog).getByRole('button', { name: '下一題' }))
    await user.click(within(dialog).getByRole('radio', { name: '否' }))
    await user.click(within(dialog).getByRole('button', { name: '送出' }))
  }

  it('asks one question at a time without showing any answer', async () => {
    const { user, dialog } = await openQuiz()

    expect(quizApi.get).toHaveBeenCalledWith('job-1', 'quiz-1')
    expect(await within(dialog).findByText('第 1 / 2 題')).toBeInTheDocument()
    expect(within(dialog).getByText('這集主要在講什麼？')).toBeInTheDocument()
    expect(within(dialog).queryByText('講者主張砍一成。')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('開場就說今天談預算。')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/正確答案/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '上一題' })).toBeDisabled()

    await user.click(within(dialog).getByRole('radio', { name: '預算' }))
    await user.click(within(dialog).getByRole('button', { name: '下一題' }))
    expect(within(dialog).getByText('講者主張砍一成。')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '上一題' }))
    expect(within(dialog).getByRole('radio', { name: '預算' })).toBeChecked() // the answer is kept
  })

  it('can only be sent once every question has an answer', async () => {
    const { user, dialog } = await openQuiz()
    await user.click(await within(dialog).findByRole('button', { name: '下一題' }))

    expect(within(dialog).getByRole('button', { name: '送出' })).toBeDisabled()
    expect(within(dialog).getByText('還有 2 題沒有作答')).toBeInTheDocument()
  })

  it('sends the answers and shows the score with each question’s answers and explanation', async () => {
    const { user, dialog } = await openQuiz()

    await answerAll(user, dialog)

    expect(quizApi.submitAttempt).toHaveBeenCalledWith('job-1', 'quiz-1', [1, 1])
    expect(await within(dialog).findByText('答對 1 / 2 題')).toBeInTheDocument()
    const [first, second] = within(dialog).getAllByRole('listitem')
    expect(first).toHaveTextContent('答對')
    expect(first).toHaveTextContent('你的答案：預算')
    expect(first).toHaveTextContent('正確答案：預算')
    expect(first).toHaveTextContent('開場就說今天談預算。')
    expect(second).toHaveTextContent('答錯')
    expect(second).toHaveTextContent('你的答案：否')
    expect(second).toHaveTextContent('正確答案：是')
    expect(second).toHaveTextContent('他說要砍一成。')
  })

  it('jumps to the part of the recording a result points at', async () => {
    const { user, dialog } = await openQuiz()
    await answerAll(user, dialog)

    await user.click(await within(dialog).findByRole('button', { name: '0:12' }))

    expect(document.querySelector('audio')?.currentTime).toBe(12)
  })

  it('can be taken again from the start, and the list then shows the best score', async () => {
    const { user, dialog } = await openQuiz()
    vi.mocked(quizApi.list).mockResolvedValue([{ ...completedQuiz, bestCorrectCount: 1 }])
    await answerAll(user, dialog)

    await user.click(await within(dialog).findByRole('button', { name: '重做' }))

    expect(within(dialog).getByText('第 1 / 2 題')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: '預算' })).not.toBeChecked()
    await user.keyboard('{Escape}')
    const card = screen.getByRole('region', { name: '測驗' })
    expect(await within(card).findByText('最佳 1 / 2')).toBeInTheDocument()
  })

  it('says so inside the dialog when the quiz cannot be loaded, and can try again', async () => {
    vi.mocked(quizApi.get).mockRejectedValueOnce(new Error('network'))
    const { user, dialog } = await openQuiz()

    await user.click(await within(dialog).findByRole('button', { name: '重試' }))

    expect(await within(dialog).findByText('第 1 / 2 題')).toBeInTheDocument()
  })

  it('can be taken on a phone, from the Studio sheet', async () => {
    await renderCompletedJob()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'AI 工具' }))
    await openStudioTool('測驗')
    const card = await screen.findByRole('region', { name: '測驗' })

    await user.click(await within(card).findByRole('button', { name: '作答' }))

    expect(await screen.findByText('第 1 / 2 題')).toBeInTheDocument()
  })
})

describe('JobDetailPage quiz staleness and export', () => {
  const quizQuestions: QuizQuestion[] = [
    {
      kind: 'true_false',
      prompt: '講者主張砍一成。',
      options: ['是', '否'],
      correctOption: 0,
      explanation: '他說要砍一成。',
      sourceTimestamps: [12],
    },
  ]

  it('flags a quiz made from an older transcript, which can still be taken', async () => {
    stubDesktopLayout()
    vi.mocked(quizApi.list).mockResolvedValue([doneQuiz, { ...doneQuiz, id: 'quiz-old', sourceRevision: 0 }])
    await renderCompletedJob({ ...mockTranscript, revision: 1 }, [], {})
    await openStudioTool('測驗')
    const card = await screen.findByRole('region', { name: '測驗' })

    const items = await within(card).findAllByRole('listitem')
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item).toHaveTextContent('逐字稿已修改，這份測驗可能過時')
      expect(within(item).getByRole('button', { name: '作答' })).toBeEnabled()
    }
  })

  it('does not flag a quiz made from the current transcript', async () => {
    stubDesktopLayout()
    vi.mocked(quizApi.list).mockResolvedValue([{ ...doneQuiz, sourceRevision: 1 }])
    await renderCompletedJob({ ...mockTranscript, revision: 1 })
    await openStudioTool('測驗')
    const card = await screen.findByRole('region', { name: '測驗' })

    await within(card).findByRole('listitem')
    expect(within(card).queryByText('逐字稿已修改，這份測驗可能過時')).not.toBeInTheDocument()
  })

  it('downloads a quiz as Markdown named after the uploaded file', async () => {
    stubDesktopLayout()
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return 'blob:quiz'
    })
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    vi.mocked(quizApi.list).mockResolvedValue([doneQuiz, { ...doneQuiz, id: 'quiz-generating', status: 'GENERATING' }])
    vi.mocked(quizApi.get).mockResolvedValue({ ...doneQuiz, questionCount: 1, questions: quizQuestions })
    await renderCompletedJob()
    const user = userEvent.setup()
    await openStudioTool('測驗')
    await within(await screen.findByRole('region', { name: '測驗' })).findAllByRole('listitem')

    await user.click(screen.getByRole('button', { name: '匯出' }))
    const items = await screen.findAllByRole('menuitem', { name: /^下載測驗/ })
    expect(items).toHaveLength(1) // only a finished quiz has anything to export
    await user.click(items[0])

    await waitFor(() => expect(names).toEqual(['interview-測驗.md']))
    expect(quizApi.get).toHaveBeenCalledWith('job-1', 'quiz-1')
    const markdown = await blobs[0].text()
    expect(markdown).toContain('### 1. 講者主張砍一成。\n\n- A. 是\n- B. 否')
    expect(markdown).toContain('## 解答\n\n### 1. A. 是\n\n他說要砍一成。\n\n依據：[00:12]')
  })
})

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

describe('JobDetailPage generated outputs (多格式輸出, COMPLETED, desktop layout)', () => {
  const generating: GeneratedOutput = {
    id: 'out-1', jobId: 'job-1', format: 'podcast_description', platform: null, instruction: null, status: 'GENERATING', failureReason: null,
    content: null, sourceRevision: 0, modelProvider: null, model: null, requestedAt: '2026-10-04T01:00:00Z', completedAt: null,
    editedAt: null,
  }
  const done: GeneratedOutput = {
    ...generating, status: 'COMPLETED', content: '這一集聊預算。\n\n## 章節\n\n00:12 開場\n', sourceRevision: 0,
    model: 'qwen3:14b', completedAt: '2026-10-04T01:00:30Z',
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('generates a podcast description in the background and lists it when done', async () => {
    stubDesktopLayout()
    vi.mocked(outputsApi.request).mockResolvedValue(generating)
    await renderCompletedJob()
    await openStudioTool('多格式輸出')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    expect(screen.getByRole('combobox', { name: '格式' })).toHaveValue('podcast_description')
    await user.click(screen.getByRole('button', { name: '產生' }))
    expect(outputsApi.request).toHaveBeenCalledWith('job-1', { format: 'podcast_description' })
    expect(screen.getByText('產生中…')).toBeInTheDocument()

    vi.mocked(outputsApi.list).mockResolvedValue([done])
    await vi.advanceTimersByTimeAsync(3000)

    const item = await screen.findByRole('button', { name: /^Podcast 介紹/ })
    expect(item).toHaveTextContent('這一集聊預算。')
  })

  it('opens one to read, copy and download as Markdown', async () => {
    stubDesktopLayout()
    const downloads = captureDownloads()
    vi.mocked(outputsApi.list).mockResolvedValue([done])
    await renderCompletedJob()
    await openStudioTool('多格式輸出')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // After setup: user-event puts its own clipboard in place.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    await user.click(await screen.findByRole('button', { name: /^Podcast 介紹/ }))
    const document = screen.getByRole('article', { name: 'Podcast 介紹' })
    expect(document).toHaveTextContent('## 章節')
    expect(screen.getByTitle('模型：qwen3:14b')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '複製' }))
    expect(writeText).toHaveBeenCalledWith(done.content)

    await user.click(screen.getByRole('button', { name: '下載 Markdown' }))
    expect(downloads[0].fileName).toBe('interview-Podcast 介紹.md')
    expect(await downloads[0].blob!.text()).toBe(done.content)
  })

  it('shows why one failed and makes another of the same kind', async () => {
    stubDesktopLayout()
    vi.mocked(outputsApi.list).mockResolvedValue([{ ...generating, status: 'FAILED', failureReason: '這個 Job 還沒有摘要，無法產生' }])
    vi.mocked(outputsApi.request).mockResolvedValue(generating)
    await renderCompletedJob()
    await openStudioTool('多格式輸出')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    expect(await screen.findByText('這個 Job 還沒有摘要，無法產生')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再試一次' }))

    expect(outputsApi.request).toHaveBeenCalledWith('job-1', { format: 'podcast_description' })
  })

  it('writes a social post for the chosen platform, with the user’s own request', async () => {
    stubDesktopLayout()
    vi.mocked(outputsApi.request).mockResolvedValue({ ...generating, format: 'social_post', platform: 'x' })
    await renderCompletedJob()
    await openStudioTool('多格式輸出')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    expect(screen.queryByRole('combobox', { name: '平台' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '格式' }), '社群貼文')
    await user.selectOptions(screen.getByRole('combobox', { name: '平台' }), 'X')
    await user.type(screen.getByRole('textbox', { name: '要求（可省略）' }), '語氣輕鬆一點')
    await user.click(screen.getByRole('button', { name: '產生' }))

    expect(outputsApi.request).toHaveBeenCalledWith('job-1', { format: 'social_post', platform: 'x', instruction: '語氣輕鬆一點' })
    expect(await screen.findByText('社群貼文（X）')).toBeInTheDocument()
  })

  it('says when a social post runs over the platform’s length limit', async () => {
    stubDesktopLayout()
    const long = '字'.repeat(150)
    vi.mocked(outputsApi.list).mockResolvedValue([{ ...done, format: 'social_post', platform: 'x', content: long }])
    await renderCompletedJob()
    await openStudioTool('多格式輸出')

    fireEvent.click(await screen.findByRole('button', { name: /^社群貼文（X）/ }))

    expect(screen.getByText('字數 300 / 280')).toBeInTheDocument()
    expect(screen.getByText('超過 X 的字數上限，請刪減後再貼')).toBeInTheDocument()
  })

  async function openDone(output: GeneratedOutput = done, transcript?: Transcript) {
    stubDesktopLayout()
    vi.mocked(outputsApi.list).mockResolvedValue([output])
    await renderCompletedJob(transcript)
    await openStudioTool('多格式輸出')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(await screen.findByRole('button', { name: /^Podcast 介紹/ }))
    return user
  }

  it('edits the content in place and marks it as changed', async () => {
    const user = await openDone()
    vi.mocked(outputsApi.update).mockResolvedValue({ ...done, content: '我改過的介紹', editedAt: '2026-10-04T02:00:00Z' })

    await user.click(screen.getByRole('button', { name: '修改' }))
    const editor = screen.getByRole('textbox', { name: 'Podcast 介紹的內容' })
    expect(editor).toHaveValue(done.content)
    await user.clear(editor)
    await user.type(editor, '我改過的介紹')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(outputsApi.update).toHaveBeenCalledWith('job-1', 'out-1', '我改過的介紹')
    expect(await screen.findByText('我改過的介紹')).toBeInTheDocument()
    expect(screen.getByText('已修改')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '所有輸出' }))
    expect(screen.getByRole('button', { name: /^Podcast 介紹/ })).toHaveTextContent('已修改')
  })

  it('keeps what was typed when saving fails, and cancelling changes nothing', async () => {
    const user = await openDone()
    vi.mocked(outputsApi.update).mockRejectedValue(new Error('network'))

    await user.click(screen.getByRole('button', { name: '修改' }))
    await user.type(screen.getByRole('textbox', { name: 'Podcast 介紹的內容' }), '加一句')
    await user.click(screen.getByRole('button', { name: '儲存' }))

    expect(await screen.findByText('修改沒有存到，請再試一次')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Podcast 介紹的內容' })).toHaveValue(done.content + '加一句')

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('textbox', { name: 'Podcast 介紹的內容' })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Podcast 介紹' })).toHaveTextContent('這一集聊預算。')
  })

  it('shows the user’s own request in the list and the document', async () => {
    await openDone({ ...done, instruction: '語氣輕鬆一點' })

    expect(screen.getByText('要求：語氣輕鬆一點')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '所有輸出' }))
    expect(screen.getByRole('button', { name: /^Podcast 介紹/ })).toHaveTextContent('要求：語氣輕鬆一點')
  })

  it('says an output may be out of date once the transcript has changed', async () => {
    await openDone(done, { ...mockTranscript, revision: 3 })

    expect(screen.getByText('逐字稿已修改，這份可能過時')).toBeInTheDocument()
  })

  it('makes the retry with the same format, platform and request as the one that failed', async () => {
    stubDesktopLayout()
    vi.mocked(outputsApi.list).mockResolvedValue([
      { ...generating, format: 'social_post', platform: 'threads', instruction: '短一點', status: 'FAILED', failureReason: '產生失敗，請再試一次' },
    ])
    vi.mocked(outputsApi.request).mockResolvedValue(generating)
    await renderCompletedJob()
    await openStudioTool('多格式輸出')

    fireEvent.click(await screen.findByRole('button', { name: '再試一次' }))

    expect(outputsApi.request).toHaveBeenCalledWith('job-1', { format: 'social_post', platform: 'threads', instruction: '短一點' })
  })
})

describe('JobDetailPage translation (譯文, COMPLETED, desktop layout)', () => {
  // multiSpeakerTranscript: 歡迎收聽 / 今天請到來賓 / 大家好 / 先聊聊近況
  const translating: TranslationSummary = {
    language: 'ja', status: 'GENERATING', failureReason: null, totalSegments: 4, translatedSegments: 0, modelProvider: null,
    model: null, requestedAt: '2026-10-04T03:00:00Z', completedAt: null,
  }
  const done = { ...translating, status: 'COMPLETED' as const, translatedSegments: 4, model: 'qwen3:14b', completedAt: '2026-10-04T03:01:00Z' }
  const segments = [
    { segmentId: 'seg-d1', text: 'お聞きいただきありがとうございます', sourceText: '歡迎收聽' },
    { segmentId: 'seg-d2', text: '今日はゲストをお迎えしました', sourceText: '今天請到來賓' },
    { segmentId: 'seg-d3', text: 'こんにちは', sourceText: '大家好' },
    { segmentId: 'seg-d4', text: 'まず近況から', sourceText: '先聊聊近況' },
  ]
  const row = (text: string) => screen.getByText(text).closest('[data-segment-index]') as HTMLElement

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('translates in the background, showing progress, then shows the translation in place of the original', async () => {
    stubDesktopLayout()
    vi.mocked(translationsApi.request).mockResolvedValue(translating)
    vi.mocked(translationsApi.get).mockResolvedValue({ ...translating, segments: [] })
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.selectOptions(screen.getByRole('combobox', { name: '翻譯成' }), '日本語')
    expect(translationsApi.request).toHaveBeenCalledWith('job-1', 'ja')
    expect(await screen.findByText('翻譯成日本語中… 0/4')).toBeInTheDocument()

    vi.mocked(translationsApi.list).mockResolvedValue([done])
    vi.mocked(translationsApi.get).mockResolvedValue({ ...done, segments })
    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('こんにちは')).toBeInTheDocument()
    expect(screen.queryByText('大家好')).not.toBeInTheDocument()
    expect(row('こんにちは')).toHaveTextContent('講者 2：こんにちは') // speakers stay
    expect(within(row('こんにちは')).queryByRole('button', { name: '編輯片段' })).not.toBeInTheDocument()
  })

  it('shows original and translation together, still editable, in 雙語', async () => {
    stubDesktopLayout()
    vi.mocked(translationsApi.list).mockResolvedValue([done])
    vi.mocked(translationsApi.get).mockResolvedValue({ ...done, segments })
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.selectOptions(screen.getByRole('combobox', { name: '顯示' }), '雙語（日本語）')

    expect(await screen.findByText('こんにちは')).toBeInTheDocument()
    expect(row('大家好')).toHaveTextContent('こんにちは')
    expect(within(row('大家好')).getByRole('button', { name: '編輯片段' })).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '顯示' }), '原文')
    expect(screen.queryByText('こんにちは')).not.toBeInTheDocument()
  })

  it('deletes the shown language after confirming, going back to the original', async () => {
    stubDesktopLayout()
    vi.mocked(translationsApi.list).mockResolvedValue([done])
    vi.mocked(translationsApi.get).mockResolvedValue({ ...done, segments })
    vi.mocked(translationsApi.delete).mockResolvedValue(undefined)
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.selectOptions(screen.getByRole('combobox', { name: '顯示' }), '譯文（日本語）')
    await screen.findByText('こんにちは')

    await user.click(screen.getByRole('button', { name: '刪除日本語譯文' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '刪除' }))

    expect(translationsApi.delete).toHaveBeenCalledWith('job-1', 'ja')
    await waitFor(() => expect(screen.queryByText('こんにちは')).not.toBeInTheDocument())
    expect(screen.getByText('大家好')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '顯示' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('combobox', { name: '翻譯成' })).getByRole('option', { name: '日本語' })).toBeInTheDocument()
  })

  it('does not bring a deleted language back from a list asked for before the delete', async () => {
    stubDesktopLayout()
    const korean = { ...translating, language: 'ko' as const }
    vi.mocked(translationsApi.list).mockResolvedValue([done, korean]) // ko still translating: the page polls
    vi.mocked(translationsApi.get).mockResolvedValue({ ...done, segments })
    vi.mocked(translationsApi.delete).mockResolvedValue(undefined)
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.selectOptions(screen.getByRole('combobox', { name: '顯示' }), '譯文（日本語）')
    await screen.findByText('こんにちは')
    let answerPoll: (latest: TranslationSummary[]) => void = () => {}
    vi.mocked(translationsApi.list).mockReturnValue(new Promise((resolve) => (answerPoll = resolve)))
    await vi.advanceTimersByTimeAsync(3000) // a poll is now on its way

    await user.click(screen.getByRole('button', { name: '刪除日本語譯文' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '刪除' }))
    await waitFor(() => expect(screen.queryByText('こんにちは')).not.toBeInTheDocument())
    await act(async () => answerPoll([done, korean]))

    expect(within(screen.getByRole('combobox', { name: '顯示' })).queryByRole('option', { name: '譯文（日本語）' })).toBeNull()
  })

  it('highlights the playing segment and seeks from its timestamp in 雙語', async () => {
    stubDesktopLayout()
    vi.mocked(translationsApi.list).mockResolvedValue([done])
    vi.mocked(translationsApi.get).mockResolvedValue({ ...done, segments })
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.selectOptions(screen.getByRole('combobox', { name: '顯示' }), '雙語（日本語）')
    await screen.findByText('こんにちは')

    await user.click(within(row('大家好')).getByRole('button', { name: /0:04$/ }))
    expect(renderedMediaElement().currentTime).toBe(4)

    playTo(renderedMediaElement(), 5)
    expect(currentSegmentText()).toContain('大家好')
    expect(currentSegmentText()).toContain('こんにちは')
  })

  it('keeps the translation when deleting it fails', async () => {
    stubDesktopLayout()
    vi.mocked(translationsApi.list).mockResolvedValue([done])
    vi.mocked(translationsApi.get).mockResolvedValue({ ...done, segments })
    vi.mocked(translationsApi.delete).mockRejectedValue(new Error('down'))
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.selectOptions(screen.getByRole('combobox', { name: '顯示' }), '譯文（日本語）')
    await screen.findByText('こんにちは')

    await user.click(screen.getByRole('button', { name: '刪除日本語譯文' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '刪除' }))

    expect(await screen.findByText('無法刪除譯文，請稍後再試')).toBeInTheDocument()
    expect(screen.getByText('こんにちは')).toBeInTheDocument()
  })

  it('follows an edit: the edited segment drops its old translation until the re-translation is ready', async () => {
    stubDesktopLayout()
    vi.mocked(translationsApi.list).mockResolvedValue([done])
    vi.mocked(translationsApi.get).mockResolvedValue({ ...done, segments })
    vi.mocked(transcriptApi.updateSegmentText).mockResolvedValue({
      segment: { id: 'seg-d3', startTime: 4, endTime: 6, speakerLabel: 'S2', text: '大家好啊', originalText: '大家好' },
      revision: 1,
    })
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.selectOptions(screen.getByRole('combobox', { name: '顯示' }), '雙語（日本語）')
    await screen.findByText('こんにちは')

    await user.click(within(row('大家好')).getByRole('button', { name: '編輯片段' }))
    const editor = screen.getByRole('textbox', { name: '編輯片段文字' })
    await user.clear(editor)
    await user.type(editor, '大家好啊{Enter}')

    expect(await screen.findByText('大家好啊')).toBeInTheDocument()
    expect(screen.queryByText('こんにちは')).not.toBeInTheDocument() // translated from the old text
    expect(row('先聊聊近況')).toHaveTextContent('まず近況から') // the others stay

    // ai-service re-translates the edited segment in the background; the page keeps asking for a while after an edit.
    const retranslated = { ...done, completedAt: '2026-10-04T03:05:00Z' }
    vi.mocked(translationsApi.list).mockResolvedValue([retranslated])
    vi.mocked(translationsApi.get).mockResolvedValue({
      ...retranslated,
      segments: segments.map((s) => (s.segmentId === 'seg-d3' ? { ...s, text: 'みなさん、こんにちは', sourceText: '大家好啊' } : s)),
    })
    await vi.advanceTimersByTimeAsync(3000)

    expect(await screen.findByText('みなさん、こんにちは')).toBeInTheDocument()
  })

  it('searches the translation too in 雙語, highlighting it under the original', async () => {
    stubDesktopLayout()
    vi.mocked(translationsApi.list).mockResolvedValue([done])
    vi.mocked(translationsApi.get).mockResolvedValue({ ...done, segments })
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.selectOptions(screen.getByRole('combobox', { name: '顯示' }), '雙語（日本語）')
    await screen.findByText('こんにちは')

    await user.type(screen.getByRole('searchbox', { name: '搜尋逐字稿' }), 'こんにちは')

    expect(await screen.findByText('1 / 1')).toBeInTheDocument()
    expect(within(row('大家好')).getByText('こんにちは', { selector: 'mark' })).toBeInTheDocument()
  })

  it('keeps each translated language\'s files under its name, so the menu stays short', async () => {
    stubDesktopLayout()
    vi.mocked(translationsApi.list).mockResolvedValue([done])
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByRole('button', { name: '匯出' }))

    expect(await screen.findByRole('menuitem', { name: '日本語' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '雙語字幕（日本語，SRT）' })).not.toBeInTheDocument()
  })

  it('downloads bilingual subtitles for a translated language', async () => {
    stubDesktopLayout()
    const downloads = captureDownloads()
    vi.mocked(translationsApi.list).mockResolvedValue([done])
    vi.mocked(translationsApi.get).mockResolvedValue({ ...done, segments })
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByRole('button', { name: '匯出' }))
    // Each translated language's files are a level down, under its name.
    await user.click(await screen.findByRole('menuitem', { name: '日本語' }))
    // A real pointer crossing over to the submenu is more than jsdom lays out: pick the item straight away.
    fireEvent.click(await screen.findByRole('menuitem', { name: '雙語字幕（日本語，SRT）' }))

    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].fileName).toBe('interview-雙語-ja.srt')
    const srt = await downloads[0].blob!.text()
    expect(srt).toContain('講者 2：大家好\nこんにちは')
  })

  it('shows why a translation failed and asks again', async () => {
    stubDesktopLayout()
    vi.mocked(translationsApi.list).mockResolvedValue([{ ...translating, status: 'FAILED', translatedSegments: 2, failureReason: '翻譯失敗，請再試一次（已經翻好的不會重翻）' }])
    vi.mocked(translationsApi.request).mockResolvedValue(translating)
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    expect(await screen.findByText('翻譯失敗，請再試一次（已經翻好的不會重翻）')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再翻譯一次' }))

    expect(translationsApi.request).toHaveBeenCalledWith('job-1', 'ja')
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

describe('JobDetailPage fact check (事實查核, COMPLETED, desktop layout)', () => {
  // multiSpeakerTranscript: S1 主持人 / S2 講者 2; 大家好 at 0:04 is S2's, 先聊聊近況 at 0:06 is S1's
  const finding: FactCheckExtraction = {
    status: 'GENERATING', failureReason: null, sourceRevision: 0, modelProvider: null, model: null,
    requestedAt: '2026-10-04T03:00:00Z', completedAt: null,
  }
  const found = { ...finding, status: 'COMPLETED' as const, model: 'qwen3:14b', completedAt: '2026-10-04T03:01:00Z' }
  const claim = (overrides: Partial<Claim>): Claim => ({
    id: 'c1', jobId: 'job-1', speakerLabel: 'S2', startTime: 4, text: '大家好', claim: '台灣約有 30% 的人每天收聽 Podcast',
    kind: 'number', verdict: null, explanation: null, sources: [], checkedAt: null, checkModel: null, checking: false,
    checkError: null, sourceRevision: 0, ...overrides,
  })
  const claims = [
    claim({}),
    claim({ id: 'c2', speakerLabel: 'S1', startTime: 6, text: '先聊聊近況', claim: '主持人最近很忙', kind: 'fact', verdict: 'not_checkable' }),
  ]
  const row = (text: string) => screen.getByText(text).closest('[data-segment-index]') as HTMLElement

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('finds the checkable claims in the background, listing what was said by whom and where', async () => {
    stubDesktopLayout()
    vi.mocked(factCheckApi.find).mockResolvedValue(finding)
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('事實查核')

    await user.click(screen.getByRole('button', { name: '找出主張' }))
    expect(factCheckApi.find).toHaveBeenCalledWith('job-1')
    expect(screen.getByText('找主張中…')).toBeInTheDocument()

    vi.mocked(factCheckApi.get).mockResolvedValue({ extraction: found, claims })
    await vi.advanceTimersByTimeAsync(3000)

    const list = await screen.findByRole('list', { name: '這場的主張' })
    const [podcast, busy] = within(list).getAllByRole('listitem')
    expect(podcast).toHaveTextContent('台灣約有 30% 的人每天收聽 Podcast')
    expect(podcast).toHaveTextContent('數字')
    expect(podcast).toHaveTextContent('講者 2')
    expect(podcast).toHaveTextContent('「大家好」')
    expect(within(busy).getByText('無法查核')).toBeInTheDocument()
    expect(busy).toHaveTextContent('事實')
    fireEvent.click(within(podcast).getByRole('button', { name: '0:04' }))
    expect(renderedMediaElement().currentTime).toBe(4)
  })

  it('shows on the tile how many claims there are', async () => {
    stubDesktopLayout()
    vi.mocked(factCheckApi.get).mockResolvedValue({ extraction: found, claims })
    await renderCompletedJob(multiSpeakerTranscript)

    await waitFor(() => expect(screen.getByRole('button', { name: '事實查核' })).toHaveAccessibleDescription('2 條主張'))
  })

  it('downloads the claims and their verdicts as Markdown, headed by the title', async () => {
    stubDesktopLayout()
    const downloads = captureDownloads()
    vi.mocked(factCheckApi.get).mockResolvedValue({
      extraction: found,
      claims: [
        claim({ verdict: 'supported', explanation: '調查顯示約 30% [1]。', sources: [{ title: '收聽調查', url: 'https://example.org/s', excerpt: null }] }),
        { ...claims[1], verdict: null },
      ],
    })
    await renderCompletedJob(multiSpeakerTranscript, [], { title: '第 12 集' })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('事實查核')
    await screen.findByRole('list', { name: '這場的主張' })

    await user.click(screen.getByRole('button', { name: '下載 Markdown' }))

    expect(downloads[0].fileName).toBe('interview-事實查核.md')
    const markdown = await downloads[0].blob?.text()
    expect(markdown).toContain('# 第 12 集：事實查核')
    expect(markdown).toContain(
      '## 結論\n\n### 1. 台灣約有 30% 的人每天收聽 Podcast\n\n- 結論：有依據\n- 類型：數字\n- 時間：[00:04] 講者 2：「大家好」\n\n調查顯示約 30% [1]。\n\n來源：\n\n1. [收聽調查](https://example.org/s)',
    )
    expect(markdown).toContain('## 還沒查核\n\n### 2. 主持人最近很忙\n\n- 類型：事實\n- 時間：[00:06] 主持人：「先聊聊近況」')
  })

  it('offers no download before any claims are found', async () => {
    stubDesktopLayout()
    vi.mocked(factCheckApi.get).mockResolvedValue({ extraction: null, claims: [] })
    await renderCompletedJob(multiSpeakerTranscript)
    await openStudioTool('事實查核')

    expect(await screen.findByRole('button', { name: '找出主張' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下載 Markdown' })).toBeNull()
  })

  it('marks where a claim was said in the transcript, opening it in 事實查核', async () => {
    stubDesktopLayout()
    vi.mocked(factCheckApi.get).mockResolvedValue({ extraction: found, claims })
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const mark = await within(row('大家好')).findByRole('button', { name: '主張：台灣約有 30% 的人每天收聽 Podcast' })
    expect(within(row('歡迎收聽')).queryByRole('button', { name: /^主張：/ })).toBeNull()
    await user.click(mark)

    const list = await screen.findByRole('list', { name: '這場的主張' })
    expect(within(list).getAllByRole('listitem')[0]).toHaveAttribute('data-highlighted')
  })

  it('says which claims come from an older transcript, and finds them again', async () => {
    stubDesktopLayout()
    vi.mocked(factCheckApi.get).mockResolvedValue({ extraction: found, claims })
    vi.mocked(factCheckApi.find).mockResolvedValue(finding)
    await renderCompletedJob({ ...multiSpeakerTranscript, revision: 2 })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('事實查核')

    expect(await screen.findByText('逐字稿已修改，這些主張可能過時')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '這場的主張' })).getAllByText('依據舊版逐字稿')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '重新找出' }))

    expect(factCheckApi.find).toHaveBeenCalledWith('job-1')
  })

  it('shows why finding them failed and offers to try again', async () => {
    stubDesktopLayout()
    vi.mocked(factCheckApi.get).mockResolvedValue({
      extraction: { ...finding, status: 'FAILED', failureReason: '模型回傳的格式不正確，請再標出一次' }, claims: [],
    })
    vi.mocked(factCheckApi.find).mockResolvedValue(finding)
    await renderCompletedJob(multiSpeakerTranscript)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openStudioTool('事實查核')

    expect(await screen.findByText('模型回傳的格式不正確，請再標出一次')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再找一次' }))

    expect(factCheckApi.find).toHaveBeenCalledWith('job-1')
  })

  describe('checking the ticked claims (查核)', () => {
    const law = claim({ id: 'c3', speakerLabel: 'S1', startTime: 6, text: '先聊聊近況', claim: '某法規在去年修改', kind: 'fact' })
    const searchedThisMonth = (succeeded: number) => ({
      month: '2026-10', llm: [], transcription: [], webSearches: { succeeded, failed: 0 },
      limits: { transcriptionMinutes: 600, platformTokens: 2000000, webSearches: 30 },
    })

    beforeEach(() => {
      vi.mocked(modelsApi.available).mockResolvedValue({ models: [platformModel, gpt5], openrouterCustom: false, webSearch: true })
      vi.mocked(usageApi.getMonthly).mockResolvedValue(searchedThisMonth(27))
      vi.mocked(factCheckApi.get).mockResolvedValue({ extraction: found, claims: [...claims, law] })
    })

    async function openFactCheck() {
      stubDesktopLayout()
      await renderCompletedJob(multiSpeakerTranscript)
      await openStudioTool('事實查核')
      return screen.findByRole('list', { name: '這場的主張' })
    }

    it('says how many searches the ticked claims will use and how many are left, then checks them', async () => {
      const list = await openFactCheck()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      expect(within(list).queryByRole('checkbox', { name: '查核：主持人最近很忙' })).toBeNull() // 無法查核

      await user.click(within(list).getByRole('checkbox', { name: '查核：台灣約有 30% 的人每天收聽 Podcast' }))
      await user.click(within(list).getByRole('checkbox', { name: '查核：某法規在去年修改' }))
      expect(await screen.findByText('會用掉 2 次網路搜尋，本月還剩 3 次')).toBeInTheDocument()

      vi.mocked(factCheckApi.check).mockResolvedValue({
        extraction: found, claims: [claim({ checking: true }), claims[1], { ...law, checking: true }],
      })
      await user.click(screen.getByRole('button', { name: '查核 2 條' }))

      expect(factCheckApi.check).toHaveBeenCalledWith('job-1', ['c1', 'c3'])
      expect(within(list).getAllByText('查核中…')).toHaveLength(2)
      expect(screen.getByRole('button', { name: '查核' })).toBeDisabled() // nothing ticked any more
    })

    it('shows each verdict with its explanation and sources once checked, why a check failed, and the searches now left', async () => {
      vi.mocked(factCheckApi.get).mockResolvedValue({
        extraction: found, claims: [claim({ checking: true }), claims[1], { ...law, checking: true }],
      })
      const list = await openFactCheck()
      expect(screen.queryByText('AI 依網路搜尋整理，請自行確認來源')).toBeNull()

      vi.mocked(factCheckApi.get).mockResolvedValue({
        extraction: found,
        claims: [
          claim({
            verdict: 'disputed', explanation: '調查顯示約 22%，不是三成 [1]。', checkModel: 'qwen3:14b', checkedAt: '2026-10-04T03:05:00Z',
            sources: [{ title: '2025 Podcast 收聽調查', url: 'https://www.example.org/survey', excerpt: '每天收聽的人約 22%' }],
          }),
          claims[1],
          { ...law, checkError: '網路搜尋失敗，請再查一次' },
        ],
      })
      vi.mocked(usageApi.getMonthly).mockResolvedValue(searchedThisMonth(29))
      await vi.advanceTimersByTimeAsync(3000)

      const [podcast, , lawItem] = within(list).getAllByRole('listitem').filter((item) => item.dataset.claimId)
      await waitFor(() => expect(within(podcast).getByText('有出入')).toBeInTheDocument())
      expect(podcast).toHaveTextContent('調查顯示約 22%，不是三成 [1]。')
      const source = within(within(podcast).getByRole('list', { name: '查核來源' })).getByRole('link', { name: /2025 Podcast 收聽調查/ })
      expect(source).toHaveAttribute('href', 'https://www.example.org/survey')
      expect(source).toHaveAttribute('target', '_blank')
      expect(podcast).toHaveTextContent('example.org')
      expect(podcast).toHaveTextContent('由 qwen3:14b 查核')
      expect(lawItem).toHaveTextContent('查核失敗：網路搜尋失敗，請再查一次')
      expect(within(lawItem).getByRole('checkbox', { name: '查核：某法規在去年修改' })).toBeEnabled() // can be checked again
      expect(screen.getByText('AI 依網路搜尋整理，請自行確認來源')).toBeInTheDocument()
      expect(await screen.findByText('勾選要查核的主張，每條會用掉 1 次網路搜尋，本月還剩 1 次')).toBeInTheDocument()
    })

    it('says why the check was refused, keeping the claims ticked', async () => {
      const list = await openFactCheck()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      vi.mocked(factCheckApi.check).mockRejectedValue(new ApiError(429, {
        error: 'USAGE_LIMIT_REACHED', message: '查核 1 條主張要用 1 次網路搜尋，這個月還剩 0 次（用量上限 30 次），下個月 1 日恢復',
      }))

      await user.click(within(list).getByRole('checkbox', { name: '查核：某法規在去年修改' }))
      await user.click(screen.getByRole('button', { name: '查核 1 條' }))

      expect(await screen.findByText(/這個月還剩 0 次/)).toBeInTheDocument()
      expect(within(list).getByRole('checkbox', { name: '查核：某法規在去年修改' })).toBeChecked()
    })

    it('counts the claims still being checked against the searches left', async () => {
      vi.mocked(factCheckApi.get).mockResolvedValue({ extraction: found, claims: [claim({ checking: true }), claims[1], law] })
      const list = await openFactCheck()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      await user.click(within(list).getByRole('checkbox', { name: '查核：某法規在去年修改' }))

      expect(await screen.findByText('會用掉 1 次網路搜尋，本月還剩 2 次')).toBeInTheDocument()
    })

    it("won't check more claims than there are searches left, and still lists the claims once they're used up", async () => {
      vi.mocked(usageApi.getMonthly).mockResolvedValue(searchedThisMonth(29))
      const list = await openFactCheck()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      await user.click(within(list).getByRole('checkbox', { name: '查核：台灣約有 30% 的人每天收聽 Podcast' }))
      await user.click(within(list).getByRole('checkbox', { name: '查核：某法規在去年修改' }))

      expect(screen.getByText('勾了 2 條，本月只剩 1 次網路搜尋，請少勾幾條')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '查核 2 條' })).toBeDisabled()
    })

    it("says when this month's searches are used up, with nothing left to tick", async () => {
      vi.mocked(usageApi.getMonthly).mockResolvedValue(searchedThisMonth(30))
      const list = await openFactCheck()

      expect(await screen.findByText('這個月的網路搜尋已用完，下個月 1 日恢復；找出主張照常可以用')).toBeInTheDocument()
      const boxes = within(list).getAllByRole('checkbox')
      expect(boxes).toHaveLength(2)
      for (const box of boxes) expect(box).toBeDisabled()
      expect(screen.getByRole('button', { name: '重新找出' })).toBeEnabled()
    })

    it("can't check anything where the deployment has no web search", async () => {
      vi.mocked(modelsApi.available).mockResolvedValue({ models: [platformModel, gpt5], openrouterCustom: false, webSearch: false })
      const list = await openFactCheck()

      expect(await screen.findByText('這個部署沒有設定網路搜尋，無法查核')).toBeInTheDocument()
      expect(within(list).queryAllByRole('checkbox')).toHaveLength(0)
    })
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
