import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { providerKeysApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { SettingsPage } from './settings-page'

vi.mock('@/lib/api', () => ({
  providerKeysApi: { list: vi.fn(), save: vi.fn(), remove: vi.fn() },
}))

afterEach(() => {
  vi.clearAllMocks()
})

beforeEach(() => {
  vi.mocked(providerKeysApi.list).mockResolvedValue([
    { provider: 'openai', last4: 'a3F9', createdAt: '2026-09-26T02:00:00Z' },
  ])
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
    vi.mocked(providerKeysApi.remove).mockResolvedValue({ deleted: true })
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
