import { renderJobDetail, baseJob, mockSummary, mockChapters, renderCompletedJob, openStudioTool, stubDesktopLayout, gappedTranscript, renderGappedTranscriptOnDesktop, renderedMediaElement, playTo, currentSegmentText, multiSpeakerTranscript, captureDownloads } from '@/test/job-detail-page-support'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chapterApi, jobsApi, notesApi, qaApi, summaryApi, transcriptApi, usageApi, translationsApi } from '@/lib/api'
import type { TranslationSummary, Summary, Transcript } from '@/types/api'

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
