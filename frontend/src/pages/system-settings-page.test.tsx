import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/layout/sidebar'
import { adminSettingsApi } from '@/lib/api'
import type { AiSettings, MailSettings, SpeechSettings, User } from '@/types/api'
import { SystemSettingsPage } from './system-settings-page'

vi.mock('@/lib/api', () => ({
  systemApi: { status: vi.fn().mockResolvedValue({ setupRequired: false, mailEnabled: true }) },
  adminSettingsApi: {
    mail: vi.fn(), updateMail: vi.fn(), testMail: vi.fn(), ai: vi.fn(), updateAi: vi.fn(), checkAi: vi.fn(),
    speech: vi.fn(), updateSpeech: vi.fn(), checkSpeech: vi.fn(),
  },
}))
let signedIn: User
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: signedIn, logout: vi.fn() }) }))

const admin: User = { id: 'u1', email: 'admin@example.com', displayName: null, createdAt: '2026-10-18T00:00:00Z',
  emailVerified: true, recoveryCodesLeft: 0, admin: true }

const ai: AiSettings = {
  platformBaseUrl: 'http://gpu:8000/v1', platformApiKeySet: true, platformModel: 'Qwen/Qwen3-8B-AWQ', postMeetingModel: '',
  embeddingBaseUrl: 'http://gpu:8001/v1', embeddingApiKeySet: false, embeddingModel: 'Qwen/Qwen3-Embedding-0.6B',
  embeddingQueryInstruction: '', webSearchApiKeySet: true, fromEnvironment: true,
}
const speech: SpeechSettings = {
  sttBaseUrl: 'http://gpu:8002/v1', sttApiKeySet: false, sttModel: 'MediaTek-Research/Breeze-ASR-25', deepgramApiKeySet: false,
  diarizationThreshold: 0.6, fromEnvironment: true, diarizationAvailable: true, active: 'local',
}
const mail: MailSettings = {
  host: '', port: 587, username: '', passwordSet: false, from: '', starttls: true, smtpAuth: true, fromEnvironment: true,
  enabled: false,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/settings']}>
      <Routes>
        <Route path="/admin/settings" element={<SystemSettingsPage />} />
        <Route path="/settings" element={<p>個人設定</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  signedIn = admin
  vi.mocked(adminSettingsApi.ai).mockResolvedValue(ai)
  vi.mocked(adminSettingsApi.speech).mockResolvedValue(speech)
  vi.mocked(adminSettingsApi.mail).mockResolvedValue(mail)
})

// 系統設定（.scratch/system-settings/issues/07）：只有管理員看得到；金鑰不顯示，留空不改、清除才清；存了說一聲；可以測試、改回環境變數。
describe('SystemSettingsPage', () => {
  it('sends a member back to their own settings', () => {
    signedIn = { ...admin, admin: false }
    renderPage()

    expect(screen.getByText('個人設定')).toBeInTheDocument()
    expect(adminSettingsApi.ai).not.toHaveBeenCalled()
  })

  it('shows what is in use without ever showing a key', async () => {
    renderPage()
    const models = await screen.findByRole('region', { name: /AI 模型/ })

    expect(within(models).getByLabelText('平台模型')).toHaveValue('Qwen/Qwen3-8B-AWQ')
    expect(within(models).getByLabelText('平台模型的金鑰（沒有就留空）')).toHaveValue('')
    expect(within(models).getByLabelText('平台模型的金鑰（沒有就留空）')).toHaveAttribute('placeholder', '已設定（留空表示不改）')
    expect(within(models).getByText('目前用環境變數')).toBeInTheDocument()
    expect(await screen.findByText('目前用：本地語音辨識')).toBeInTheDocument()
    expect(await screen.findByText('目前沒有設定寄信')).toBeInTheDocument()
  })

  it('keeps a key left empty and clears one only when asked', async () => {
    vi.mocked(adminSettingsApi.updateAi).mockResolvedValue({ ...ai, fromEnvironment: false, webSearchApiKeySet: false })
    const user = userEvent.setup()
    renderPage()
    const models = await screen.findByRole('region', { name: /AI 模型/ })

    await user.clear(within(models).getByLabelText('平台模型'))
    await user.type(within(models).getByLabelText('平台模型'), 'Qwen/Qwen3-14B-AWQ')
    await user.click(within(models).getAllByRole('button', { name: '清除' })[1]) // the web search key
    await user.click(within(models).getByRole('button', { name: '儲存' }))

    expect(adminSettingsApi.updateAi).toHaveBeenCalledWith(expect.objectContaining({
      platformModel: 'Qwen/Qwen3-14B-AWQ', platformApiKey: undefined, webSearchApiKey: '',
    }))
    expect(await within(models).findByText('用這裡存的設定')).toBeInTheDocument()
  })

  it('tests the connection and says what is wrong', async () => {
    vi.mocked(adminSettingsApi.checkAi).mockResolvedValue({
      platformOk: true, platformDetail: 'Qwen/Qwen3-8B-AWQ 可以用', embeddingOk: false, embeddingDetail: '連不上 http://gpu:8001/v1',
    })
    const user = userEvent.setup()
    renderPage()
    const models = await screen.findByRole('region', { name: /AI 模型/ })

    await user.click(within(models).getByRole('button', { name: '測試連線' }))

    const results = await within(models).findByRole('list', { name: '測試結果' })
    expect(results).toHaveTextContent('平台模型：Qwen/Qwen3-8B-AWQ 可以用')
    expect(results).toHaveTextContent('Embedding：連不上 http://gpu:8001/v1')
  })

  it('goes back to the environment variables', async () => {
    vi.mocked(adminSettingsApi.speech).mockResolvedValue({ ...speech, fromEnvironment: false })
    vi.mocked(adminSettingsApi.updateSpeech).mockResolvedValue(speech)
    const user = userEvent.setup()
    renderPage()
    const section = await screen.findByRole('region', { name: /語音辨識/ })

    await user.click(await within(section).findByRole('button', { name: '改回環境變數' }))

    expect(adminSettingsApi.updateSpeech).toHaveBeenCalledWith(expect.objectContaining({ useEnvironment: true }))
  })

  it('sends a test mail and says why it failed', async () => {
    vi.mocked(adminSettingsApi.mail).mockResolvedValue({ ...mail, host: 'smtp.example.com', from: 'a@example.com', enabled: true })
    vi.mocked(adminSettingsApi.testMail).mockResolvedValue({ sent: false, error: 'Connection refused' })
    const user = userEvent.setup()
    renderPage()
    const section = await screen.findByRole('region', { name: /寄信/ })

    await user.click(await within(section).findByRole('button', { name: '寄測試信給自己' }))

    expect(await within(section).findByText(/寄不出去：Connection refused/)).toBeInTheDocument()
  })
})

describe('Sidebar', () => {
  it('shows 系統設定 to the administrator only', () => {
    const { unmount } = render(<MemoryRouter><Sidebar /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '系統設定' })).toHaveAttribute('href', '/admin/settings')
    unmount()

    signedIn = { ...admin, admin: false }
    render(<MemoryRouter><Sidebar /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: '系統設定' })).toBeNull()
  })
})
