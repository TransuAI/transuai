import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { modelsApi, providerKeysApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { SettingsPage } from './settings-page'

vi.mock('@/lib/api', () => ({
  providerKeysApi: { list: vi.fn(), save: vi.fn(), remove: vi.fn() },
  modelsApi: { available: vi.fn(), getDefault: vi.fn(), setDefault: vi.fn() },
}))

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
})

async function renderSettings() {
  render(
    <MemoryRouter>
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
