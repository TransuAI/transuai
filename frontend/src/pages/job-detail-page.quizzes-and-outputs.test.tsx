import { mockTranscript, renderCompletedJob, openStudioTool, stubDesktopLayout, captureDownloads, doneQuiz } from '@/test/job-detail-page-support'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { quizApi, usageApi, outputsApi } from '@/lib/api'
import type { GeneratedOutput, Quiz, QuizAttemptResult, QuizQuestion, Transcript } from '@/types/api'

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
