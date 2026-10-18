import { platformModel, gpt5, renderCompletedJob, openStudioTool, stubDesktopLayout, renderedMediaElement, multiSpeakerTranscript, captureDownloads } from '@/test/job-detail-page-support'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modelsApi, usageApi, factCheckApi } from '@/lib/api'
import type { Claim, FactCheckExtraction } from '@/types/api'

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
