// Shared by the JobDetailPage tests (src/pages/job-detail-page.*.test.tsx): the API mocks, per-test defaults, test data
// and render helpers. Import it first in each of those files, so its vi.mock calls are in place before anything
// loads '@/lib/api'. It was one 4,900-line file; split so vitest runs the parts in parallel.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest'
import { chapterApi, jobsApi, modelsApi, notesApi, postMeetingApi, qaApi, quizApi, speakerSuggestionsApi, summaryApi, transcriptApi, usageApi, speakerInsightsApi, outputsApi, translationsApi, decisionsApi, factCheckApi } from '@/lib/api'
import type { SpeakerInsights, Chapter, Job, JobUsage, QaTurn, Quiz, Summary, Transcript } from '@/types/api'

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

// Every test renders the whole page; on a busy machine (CI) the longer ones take a few seconds.
vi.setConfig({ testTimeout: 15_000 })

vi.mock('@/hooks/use-job-socket', () => ({
  useJobSocket: vi.fn(),
}))

let JobDetailPage: typeof import('@/pages/job-detail-page').JobDetailPage

afterEach(() => {
  vi.restoreAllMocks()
  // Only forgets recorded calls (implementations stay), so "was not called" holds per test.
  vi.clearAllMocks()
})

export const platformModel = { provider: 'platform', model: 'Qwen/Qwen3.5-9B', supportsTools: false }
export const gpt5 = { provider: 'openai', model: 'gpt-5', supportsTools: true }

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
  ;({ JobDetailPage } = await import('@/pages/job-detail-page'))
})

export function renderJobDetail(jobId = 'job-1', search = '') {
  return render(
    <MemoryRouter initialEntries={[`/jobs/${jobId}${search}`]}>
      <Routes>
        <Route path="/jobs/:jobId" element={<JobDetailPage />} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  )
}

export const baseJob: Job = {
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

export const mockTranscript: Transcript = {
  jobId: 'job-1',
  language: 'zh',
  fullText: 'hello world',
  revision: 0,
  segments: [{ id: 'seg-1', startTime: 5, endTime: 8, speakerLabel: null, text: '哈囉世界', originalText: '哈囉世界' }],
  speakers: [],
}

export const mockSummary: Summary = {
  jobId: 'job-1',
  summaryText: '這是摘要內容',
  sourceRevision: 0,
  regenerationStatus: 'IDLE',
  modelProvider: 'openai',
  model: 'gpt-5-mini',
}

export const noUsage: JobUsage = { records: [], totals: { inputTokens: 0, outputTokens: 0, audioSeconds: 0 } }
export const noInsights: SpeakerInsights = {
  status: 'NONE', failureReason: null, sourceRevision: 0, modelProvider: null, model: null, requestedAt: null, completedAt: null, items: [],
}

export const mockChapters: Chapter[] = [{ id: 'ch-1', jobId: 'job-1', title: '開場', startTime: 12, sequenceNo: 0 }]

export async function renderCompletedJob(
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
export async function openStudioTool(name: string) {
  const back = screen.queryByRole('button', { name: '返回 AI 工具' })
  if (back) fireEvent.click(back)
  fireEvent.click(await screen.findByRole('button', { name }))
}

export function stubDesktopLayout() {
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
export function stubSwitchableLayout(initiallyDesktop: boolean) {
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









// The segments deliberately leave a 10–12s gap to exercise the gap rule of the current
// segment (目前片段, see frontend CONTEXT.md).
export const gappedTranscript: Transcript = {
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

export async function renderGappedTranscriptOnDesktop(qaHistory: QaTurn[] = []) {
  stubDesktopLayout()
  await renderCompletedJob(gappedTranscript, qaHistory)
  await screen.findByText('第一句')
  return renderedMediaElement()
}

export function searchbox() {
  return screen.getByRole('searchbox', { name: '搜尋逐字稿' })
}

export function renderedMediaElement() {
  const media = document.querySelector('audio')
  if (!media) throw new Error('media element not rendered')
  return media
}

export function playTo(media: HTMLMediaElement, seconds: number) {
  media.currentTime = seconds
  fireEvent.timeUpdate(media)
}

export function currentSegmentText() {
  return document.querySelector('[aria-current="true"]')?.textContent ?? null
}




export const searchableTranscript: Transcript = {
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




// 講者 1 speaks first, then 講者 2, then 講者 1 again.
export const multiSpeakerTranscript: Transcript = {
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
export const soloTranscript: Transcript = {
  ...multiSpeakerTranscript,
  segments: multiSpeakerTranscript.segments.map((segment) => ({ ...segment, speakerLabel: 'S1' })),
  speakers: [{ label: 'S1', displayName: '講者 1', displayOrder: 1 }],
}












// jsdom doesn't navigate on link clicks: capture what would have been downloaded.
export function captureDownloads() {
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






export const doneQuiz: Quiz = {
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
