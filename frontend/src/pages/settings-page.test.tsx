import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { connectionsApi, modelsApi, postMeetingSettingsApi, providerKeysApi, usageApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { leaveTo } from '@/lib/navigation'
import { SettingsPage } from './settings-page'

vi.mock('@/lib/api', () => ({
  providerKeysApi: { list: vi.fn(), save: vi.fn(), remove: vi.fn() },
  modelsApi: { available: vi.fn(), getDefault: vi.fn(), setDefault: vi.fn() },
  usageApi: { getMonthly: vi.fn() },
  connectionsApi: { list: vi.fn(), authorize: vi.fn(), remove: vi.fn() },
  postMeetingSettingsApi: { get: vi.fn(), update: vi.fn() },
}))

vi.mock('@/lib/navigation', () => ({ leaveTo: vi.fn() }))

const logoutEverywhere = vi.fn()
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ logoutEverywhere }) }))

afterEach(() => {
  vi.clearAllMocks()
})

const platform = { provider: 'platform', model: 'Qwen/Qwen3.5-9B', supportsTools: false }
const gpt5mini = { provider: 'openai', model: 'gpt-5-mini', supportsTools: true }

beforeEach(() => {
  vi.mocked(providerKeysApi.list).mockResolvedValue([
    { provider: 'openai', last4: 'a3F9', createdAt: '2026-09-26T02:00:00Z' },
  ])
  vi.mocked(modelsApi.available).mockResolvedValue({
    models: [platform, { provider: 'openai', model: 'gpt-5', supportsTools: true }, gpt5mini],
    openrouterCustom: false,
  })
  vi.mocked(modelsApi.getDefault).mockResolvedValue(platform)
  vi.mocked(usageApi.getMonthly).mockResolvedValue({ month: '2026-09', limits, llm: [], transcription: [] })
  vi.mocked(connectionsApi.list).mockResolvedValue([
    { service: 'google', status: 'NOT_CONNECTED', connectedAt: null },
    { service: 'notion', status: 'NOT_CONNECTED', connectedAt: null },
  ])
  vi.mocked(postMeetingSettingsApi.get).mockResolvedValue({
    notionMeetingsPage: null,
    todoDestination: 'GOOGLE_TASKS',
  })
})

async function renderSettings(url = '/settings') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <SettingsPage />
      <Toaster />
    </MemoryRouter>,
  )
  return screen.findByRole('region', { name: '自有金鑰' })
}

const row = (section: HTMLElement, provider: string) =>
  within(section).getByRole('group', { name: provider })

describe('SettingsPage own API keys (自有金鑰)', () => {
  it('lists every supported provider, showing only the last four characters of a saved key', async () => {
    const section = await renderSettings()

    expect(await within(row(section, 'OpenAI')).findByText('…a3F9')).toBeInTheDocument()
    for (const provider of ['Anthropic', 'Google Gemini', 'OpenRouter']) {
      expect(within(row(section, provider)).getByText('未設定')).toBeInTheDocument()
    }
  })

  it('saves a key and shows its last four characters', async () => {
    const user = userEvent.setup()
    vi.mocked(providerKeysApi.save).mockResolvedValue({ provider: 'anthropic', last4: 'xyz9', createdAt: '2026-09-26T03:00:00Z' })
    const section = await renderSettings()
    const anthropic = row(section, 'Anthropic')

    await user.type(within(anthropic).getByLabelText('Anthropic 金鑰'), 'sk-ant-api03-xyz9')
    await user.click(within(anthropic).getByRole('button', { name: '儲存' }))

    expect(providerKeysApi.save).toHaveBeenCalledWith('anthropic', 'sk-ant-api03-xyz9')
    expect(await within(anthropic).findByText('…xyz9')).toBeInTheDocument()
    expect(within(anthropic).getByLabelText('Anthropic 金鑰')).toHaveValue('')
  })

  it("replaces a saved key through the same box, which doesn't reveal the old one", async () => {
    const user = userEvent.setup()
    vi.mocked(providerKeysApi.save).mockResolvedValue({ provider: 'openai', last4: 'new1', createdAt: '2026-09-26T03:00:00Z' })
    const section = await renderSettings()
    const openai = row(section, 'OpenAI')
    await within(openai).findByText('…a3F9')

    expect(within(openai).getByLabelText('OpenAI 金鑰')).toHaveValue('')
    await user.type(within(openai).getByLabelText('OpenAI 金鑰'), 'sk-proj-new1')
    await user.click(within(openai).getByRole('button', { name: '替換' }))

    expect(await within(openai).findByText('…new1')).toBeInTheDocument()
  })

  it('does not save an empty key', async () => {
    const section = await renderSettings()

    expect(within(row(section, 'OpenRouter')).getByRole('button', { name: '儲存' })).toBeDisabled()
  })

  it('shows why a key was rejected and keeps what the user typed', async () => {
    const user = userEvent.setup()
    vi.mocked(providerKeysApi.save).mockRejectedValue(
      new ApiError(400, { error: 'INVALID_ARGUMENT', message: 'gemini 回報金鑰無效或沒有權限' }),
    )
    const section = await renderSettings()
    const gemini = row(section, 'Google Gemini')

    await user.type(within(gemini).getByLabelText('Google Gemini 金鑰'), 'AIza-wrong')
    await user.click(within(gemini).getByRole('button', { name: '儲存' }))

    expect(await within(gemini).findByText('gemini 回報金鑰無效或沒有權限')).toBeInTheDocument()
    expect(within(gemini).getByLabelText('Google Gemini 金鑰')).toHaveValue('AIza-wrong')
    expect(within(gemini).getByText('未設定')).toBeInTheDocument()
  })

  it('deletes a key after the user confirms', async () => {
    const user = userEvent.setup()
    vi.mocked(providerKeysApi.remove).mockResolvedValue({ deleted: true, defaultModelReset: false })
    const section = await renderSettings()
    const openai = row(section, 'OpenAI')
    await within(openai).findByText('…a3F9')

    await user.click(within(openai).getByRole('button', { name: '刪除' }))
    expect(providerKeysApi.remove).not.toHaveBeenCalled()
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '刪除' }))

    expect(providerKeysApi.remove).toHaveBeenCalledWith('openai')
    expect(await within(openai).findByText('未設定')).toBeInTheDocument()
  })
})

describe('SettingsPage default model (預設模型)', () => {
  async function renderDefaultModel() {
    await renderSettings()
    return screen.findByRole('region', { name: '預設模型' })
  }

  it('starts on the platform model and offers the models of every provider with a key', async () => {
    const section = await renderDefaultModel()

    expect(await within(section).findByRole('radio', { name: '平台模型（Qwen/Qwen3.5-9B）' })).toBeChecked()
    expect(within(section).getByRole('radio', { name: 'OpenAI · gpt-5-mini' })).not.toBeChecked()
    expect(within(section).queryByLabelText('OpenRouter 模型 ID')).not.toBeInTheDocument()
  })

  it('makes a chosen model the default', async () => {
    const user = userEvent.setup()
    vi.mocked(modelsApi.setDefault).mockResolvedValue(gpt5mini)
    const section = await renderDefaultModel()

    await user.click(await within(section).findByRole('radio', { name: 'OpenAI · gpt-5-mini' }))

    expect(modelsApi.setDefault).toHaveBeenCalledWith('openai', 'gpt-5-mini')
    expect(await within(section).findByRole('radio', { name: 'OpenAI · gpt-5-mini' })).toBeChecked()
    expect(await screen.findByText('預設模型已改成 gpt-5-mini')).toBeInTheDocument()
  })

  it('takes any OpenRouter model ID when there is an OpenRouter key, and says why one is refused', async () => {
    const user = userEvent.setup()
    vi.mocked(modelsApi.available).mockResolvedValue({ models: [platform], openrouterCustom: true })
    vi.mocked(modelsApi.setDefault).mockRejectedValue(
      new ApiError(400, { error: 'INVALID_ARGUMENT', message: 'OpenRouter 上找不到「deepseek/nope」這個模型' }),
    )
    const section = await renderDefaultModel()

    await user.type(await within(section).findByLabelText('OpenRouter 模型 ID'), 'deepseek/nope')
    await user.click(within(section).getByRole('button', { name: '使用這個模型' }))

    expect(modelsApi.setDefault).toHaveBeenCalledWith('openrouter', 'deepseek/nope')
    expect(await within(section).findByText('OpenRouter 上找不到「deepseek/nope」這個模型')).toBeInTheDocument()
  })

  it('says so when deleting a key brings the default back to the platform model', async () => {
    const user = userEvent.setup()
    vi.mocked(modelsApi.getDefault).mockResolvedValueOnce(gpt5mini).mockResolvedValue(platform)
    vi.mocked(providerKeysApi.remove).mockResolvedValue({ deleted: true, defaultModelReset: true })
    const section = await renderDefaultModel()
    expect(await within(section).findByRole('radio', { name: 'OpenAI · gpt-5-mini' })).toBeChecked()
    vi.mocked(modelsApi.available).mockResolvedValue({ models: [platform], openrouterCustom: false })

    const keys = screen.getByRole('region', { name: '自有金鑰' })
    await user.click(within(row(keys, 'OpenAI')).getByRole('button', { name: '刪除' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '刪除' }))

    expect(await screen.findByText('預設模型已改回平台模型')).toBeInTheDocument()
    expect(await within(section).findByRole('radio', { name: '平台模型（Qwen/Qwen3.5-9B）' })).toBeChecked()
  })
})

const limits = { transcriptionMinutes: 600, platformTokens: 2000000 }

describe('SettingsPage monthly usage (本月用量)', () => {
  const llmSum = (provider: string, model: string, keySource: string, inputTokens: number, outputTokens: number, calls: number, callsWithUnknownUsage = 0) =>
    ({ provider, model, keySource, inputTokens, outputTokens, calls, callsWithUnknownUsage })

  async function renderUsage() {
    await renderSettings()
    return screen.findByRole('region', { name: '本月用量' })
  }

  it("shows this month's usage per model, keeping the platform model, own keys and transcription apart", async () => {
    vi.mocked(usageApi.getMonthly).mockResolvedValue({
      month: '2026-09', limits,
      llm: [
        llmSum('openai', 'gpt-5', 'own_key', 12000, 3400, 8),
        llmSum('platform', 'Qwen/Qwen3.5-9B', 'platform', 5300, 700, 4),
      ],
      transcription: [{ provider: 'deepgram', model: 'nova-3', audioSeconds: 1530, calls: 3, callsWithUnknownUsage: 0 }],
    })
    const section = await renderUsage()

    expect(usageApi.getMonthly).toHaveBeenCalledWith(undefined) // the server knows which month it is
    expect(await within(section).findByText('2026 年 9 月')).toBeInTheDocument()
    const platformGroup = within(section).getByRole('group', { name: '平台模型' })
    expect(within(platformGroup).getByText('Qwen/Qwen3.5-9B')).toBeInTheDocument()
    expect(within(platformGroup).getByText('輸入 5,300 · 輸出 700 tokens · 4 次')).toBeInTheDocument()
    const ownKeyGroup = within(section).getByRole('group', { name: '自有金鑰' })
    expect(within(ownKeyGroup).getByText('OpenAI · gpt-5')).toBeInTheDocument()
    expect(within(ownKeyGroup).getByText('輸入 12,000 · 輸出 3,400 tokens · 8 次')).toBeInTheDocument()
    const transcriptionGroup = within(section).getByRole('group', { name: '轉錄' })
    expect(within(transcriptionGroup).getByText('nova-3')).toBeInTheDocument()
    expect(within(transcriptionGroup).getByText('25.5 分鐘 · 3 次')).toBeInTheDocument()
  })

  it("counts this month's web searches against their limit, only the ones that went through", async () => {
    vi.mocked(usageApi.getMonthly).mockResolvedValue({
      month: '2026-09', limits: { ...limits, webSearches: 30 }, llm: [], transcription: [],
      webSearches: { succeeded: 27, failed: 2 },
    })
    const section = await renderUsage()

    const limitsGroup = await within(section).findByRole('group', { name: '用量上限' })
    expect(within(limitsGroup).getByText('27 次 / 30 次 · 剩 3 次')).toBeInTheDocument()
  })

  it("shows how much of this month's limits is used and left", async () => {
    vi.mocked(usageApi.getMonthly).mockResolvedValue({
      month: '2026-09', limits,
      llm: [llmSum('platform', 'Qwen/Qwen3.5-9B', 'platform', 5300, 700, 4), llmSum('openai', 'gpt-5', 'own_key', 9000, 1000, 2)],
      transcription: [{ provider: 'deepgram', model: 'nova-3', audioSeconds: 1530, calls: 3, callsWithUnknownUsage: 0 }],
    })
    const section = await renderUsage()

    const limitsGroup = await within(section).findByRole('group', { name: '用量上限' })
    expect(within(limitsGroup).getByText('25.5 分鐘 / 600.0 分鐘 · 剩 574.5 分鐘')).toBeInTheDocument()
    // own keys don't count toward the platform model's limit
    expect(within(limitsGroup).getByText('6,000 tokens / 2,000,000 tokens · 剩 1,994,000 tokens')).toBeInTheDocument()
  })

  it('says when a limit is used up and when it comes back', async () => {
    vi.mocked(usageApi.getMonthly).mockResolvedValue({
      month: '2026-09', limits, llm: [],
      transcription: [{ provider: 'deepgram', model: 'nova-3', audioSeconds: 36300, calls: 40, callsWithUnknownUsage: 0 }],
    })
    const section = await renderUsage()

    const limitsGroup = await within(section).findByRole('group', { name: '用量上限' })
    expect(within(limitsGroup).getByText('605.0 分鐘 / 600.0 分鐘 · 已到上限，下個月 1 日恢復')).toBeInTheDocument()
  })

  it('says when some calls of a model had no reported usage', async () => {
    vi.mocked(usageApi.getMonthly).mockResolvedValue({
      month: '2026-09', limits,
      llm: [llmSum('platform', 'Qwen/Qwen3.5-9B', 'platform', 300, 40, 3, 1)],
      transcription: [],
    })
    const section = await renderUsage()

    expect(await within(section).findByText('其中 1 次用量未知，未計入')).toBeInTheDocument()
  })

  it('goes back to an earlier month and forward again, but not past the current one', async () => {
    const user = userEvent.setup()
    const section = await renderUsage()
    await within(section).findByText('2026 年 9 月')
    expect(within(section).getByRole('button', { name: '下個月' })).toBeDisabled()

    vi.mocked(usageApi.getMonthly).mockResolvedValue({
      month: '2026-08', limits,
      llm: [llmSum('platform', 'Qwen/Qwen3.5-9B', 'platform', 10, 1, 1)],
      transcription: [],
    })
    await user.click(within(section).getByRole('button', { name: '上個月' }))

    expect(usageApi.getMonthly).toHaveBeenLastCalledWith('2026-08')
    expect(await within(section).findByText('2026 年 8 月')).toBeInTheDocument()
    expect(within(section).getByText('輸入 10 · 輸出 1 tokens · 1 次')).toBeInTheDocument()

    vi.mocked(usageApi.getMonthly).mockResolvedValue({ month: '2026-09', limits, llm: [], transcription: [] })
    await user.click(within(section).getByRole('button', { name: '下個月' }))

    expect(usageApi.getMonthly).toHaveBeenLastCalledWith('2026-09')
    expect(await within(section).findByText('2026 年 9 月')).toBeInTheDocument()
  })

  it('says so when a month has no usage', async () => {
    const section = await renderUsage()

    expect(await within(section).findByText('這個月沒有用量')).toBeInTheDocument()
  })

  it('offers to try again when the usage cannot be loaded', async () => {
    const user = userEvent.setup()
    vi.mocked(usageApi.getMonthly).mockRejectedValueOnce(new Error('network'))
    const section = await renderUsage()

    await user.click(await within(section).findByRole('button', { name: '重試' }))

    expect(await within(section).findByText('2026 年 9 月')).toBeInTheDocument()
    expect(usageApi.getMonthly).toHaveBeenLastCalledWith(undefined)
  })

  it('crosses into the previous year', async () => {
    const user = userEvent.setup()
    vi.mocked(usageApi.getMonthly).mockResolvedValue({ month: '2027-01', limits, llm: [], transcription: [] })
    const section = await renderUsage()
    await within(section).findByText('2027 年 1 月')

    await user.click(within(section).getByRole('button', { name: '上個月' }))

    expect(usageApi.getMonthly).toHaveBeenLastCalledWith('2026-12')
  })
})

describe('SettingsPage linked accounts (已連結的帳號)', () => {
  async function renderAccounts(url?: string) {
    await renderSettings(url)
    return screen.findByRole('region', { name: '已連結的帳號' })
  }
  const account = (section: HTMLElement, name: string) => within(section).getByRole('group', { name })

  it('shows whether Google and Notion are linked, and asks to link again when a link stopped working', async () => {
    vi.mocked(connectionsApi.list).mockResolvedValue([
      { service: 'google', status: 'CONNECTED', connectedAt: '2026-09-26T02:00:00Z' },
      { service: 'notion', status: 'INVALID', connectedAt: '2026-09-20T02:00:00Z' },
    ])
    const section = await renderAccounts()

    const google = await within(section).findByRole('group', { name: 'Google' })
    expect(within(google).getByText('已連結')).toBeInTheDocument()
    expect(within(google).getByRole('button', { name: '中斷連結' })).toBeInTheDocument()
    const notion = account(section, 'Notion')
    expect(within(notion).getByText('Notion 連結已失效，請重新連結')).toBeInTheDocument()
    expect(within(notion).getByRole('button', { name: '重新連結' })).toBeInTheDocument()
  })

  it('sends the user to the service to link it', async () => {
    const user = userEvent.setup()
    vi.mocked(connectionsApi.authorize).mockResolvedValue({ authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' })
    const section = await renderAccounts()
    const google = await within(section).findByRole('group', { name: 'Google' })
    expect(within(google).getByText('未連結')).toBeInTheDocument()

    await user.click(within(google).getByRole('button', { name: '連結' }))

    expect(connectionsApi.authorize).toHaveBeenCalledWith('google')
    expect(leaveTo).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1')
  })

  it('says why linking cannot start', async () => {
    const user = userEvent.setup()
    vi.mocked(connectionsApi.authorize).mockRejectedValue(
      new ApiError(409, { error: 'FAILED_PRECONDITION', message: '伺服器沒有設定 Google OAuth client，暫時無法連結 Google' }),
    )
    const section = await renderAccounts()

    await user.click(within(await within(section).findByRole('group', { name: 'Google' })).getByRole('button', { name: '連結' }))

    expect(await screen.findByText('伺服器沒有設定 Google OAuth client，暫時無法連結 Google')).toBeInTheDocument()
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it('tells the user how linking went when they come back from the service', async () => {
    await renderAccounts('/settings?connected=notion')
    expect(await screen.findByText('已連結 Notion')).toBeInTheDocument()
  })

  it('tells the user when linking failed', async () => {
    await renderAccounts('/settings?connection_failed=google')
    expect(await screen.findByText('無法連結 Google，請再試一次')).toBeInTheDocument()
  })

  it('does not repeat whatever a crafted link puts in the address', async () => {
    await renderAccounts('/settings?connected=Anything')
    expect(await screen.findByText('已連結帳號')).toBeInTheDocument()
    expect(screen.queryByText(/Anything/)).not.toBeInTheDocument()
  })

  it('unlinks after the user confirms', async () => {
    const user = userEvent.setup()
    vi.mocked(connectionsApi.list).mockResolvedValue([
      { service: 'google', status: 'CONNECTED', connectedAt: '2026-09-26T02:00:00Z' },
      { service: 'notion', status: 'NOT_CONNECTED', connectedAt: null },
    ])
    vi.mocked(connectionsApi.remove).mockResolvedValue({ revoked: true })
    const section = await renderAccounts()
    const google = await within(section).findByRole('group', { name: 'Google' })

    await user.click(within(google).getByRole('button', { name: '中斷連結' }))
    expect(connectionsApi.remove).not.toHaveBeenCalled()
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '中斷連結' }))

    expect(connectionsApi.remove).toHaveBeenCalledWith('google')
    expect(await within(google).findByText('未連結')).toBeInTheDocument()
  })

  it('says so when the service could not be told to revoke access', async () => {
    const user = userEvent.setup()
    vi.mocked(connectionsApi.list).mockResolvedValue([
      { service: 'google', status: 'NOT_CONNECTED', connectedAt: null },
      { service: 'notion', status: 'CONNECTED', connectedAt: '2026-09-26T02:00:00Z' },
    ])
    vi.mocked(connectionsApi.remove).mockResolvedValue({ revoked: false })
    const section = await renderAccounts()

    await user.click(within(await within(section).findByRole('group', { name: 'Notion' })).getByRole('button', { name: '中斷連結' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '中斷連結' }))

    expect(await screen.findByText('已中斷連結，但沒能通知 Notion 撤銷授權，請到 Notion 的設定移除 TransuAI')).toBeInTheDocument()
  })
})

describe('SettingsPage post-meeting settings (會後處理)', () => {
  const PAGE_URL = 'https://www.notion.so/Team/Meeting-notes-1f2e3d4c5b6a47889900aabbccddeeff'

  async function renderPostMeeting() {
    await renderSettings()
    return screen.findByRole('region', { name: '會後處理' })
  }

  it('says plainly what the Notion page is for and where to copy its link, without asking to share anything', async () => {
    vi.mocked(postMeetingSettingsApi.get).mockResolvedValue({
      notionMeetingsPage: { id: 'page-1', title: 'Meeting notes', url: PAGE_URL },
      todoDestination: 'GOOGLE_TASKS',
    })
    const section = await renderPostMeeting()

    expect(await within(section).findByLabelText('Notion 會議紀錄位置')).toHaveValue(PAGE_URL)
    expect(within(section).getByText('目前：Meeting notes')).toBeInTheDocument()
    expect(within(section).getByText(/每場會議會在這個頁面底下新增一頁/)).toBeInTheDocument()
    expect(within(section).getByText(/複製連結/)).toBeInTheDocument()
    expect(within(section).queryByText(/分享給/)).not.toBeInTheDocument()
    expect(within(section).queryByLabelText(/待辦資料庫/)).not.toBeInTheDocument()
    expect(within(section).getByRole('radio', { name: 'Google Tasks' })).toBeChecked()
  })

  it('saves the Notion page and where todos go', async () => {
    const user = userEvent.setup()
    vi.mocked(postMeetingSettingsApi.update).mockResolvedValue({
      notionMeetingsPage: { id: 'page-1', title: 'Meeting notes', url: PAGE_URL },
      todoDestination: 'NOTION',
    })
    const section = await renderPostMeeting()

    await user.type(await within(section).findByLabelText('Notion 會議紀錄位置'), PAGE_URL)
    await user.click(within(section).getByRole('radio', { name: 'Notion 會議紀錄裡（打勾清單）' }))
    await user.click(within(section).getByRole('button', { name: '儲存' }))

    expect(postMeetingSettingsApi.update).toHaveBeenCalledWith({ notionMeetingsPageUrl: PAGE_URL, todoDestination: 'NOTION' })
    expect(await within(section).findByText('目前：Meeting notes')).toBeInTheDocument()
    expect(within(section).getByRole('radio', { name: 'Notion 會議紀錄裡（打勾清單）' })).toBeChecked()
  })

  it('asks for the Notion page when todos are to go into it', async () => {
    const user = userEvent.setup()
    const section = await renderPostMeeting()

    await user.click(await within(section).findByRole('radio', { name: 'Notion 會議紀錄裡（打勾清單）' }))

    expect(within(section).getByText(/請先填上 Notion 會議紀錄位置/)).toBeInTheDocument()
  })

  it('says why Notion would not take a page', async () => {
    const user = userEvent.setup()
    vi.mocked(postMeetingSettingsApi.update).mockRejectedValue(
      new ApiError(400, { error: 'INVALID_ARGUMENT', message: '這是 Notion 資料庫，請改貼一個一般頁面的連結' }),
    )
    const section = await renderPostMeeting()

    await user.type(await within(section).findByLabelText('Notion 會議紀錄位置'), PAGE_URL)
    await user.click(within(section).getByRole('button', { name: '儲存' }))

    expect(await within(section).findByText('這是 Notion 資料庫，請改貼一個一般頁面的連結')).toBeInTheDocument()
  })
})

describe('SettingsPage account (帳號)', () => {
  it('logs out of every device', async () => {
    logoutEverywhere.mockResolvedValue(undefined)
    const clicker = userEvent.setup()
    await renderSettings()
    const section = screen.getByRole('region', { name: '帳號' })

    await clicker.click(within(section).getByRole('button', { name: '登出所有裝置' }))

    expect(logoutEverywhere).toHaveBeenCalled()
  })
})
