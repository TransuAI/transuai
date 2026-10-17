import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetSystemStatus } from '@/hooks/use-system-status'
import { authApi, systemApi } from '@/lib/api'
import { ForgotPasswordPage } from './forgot-password-page'
import { LoginPage } from './login-page'
import { RegisterPage } from './register-page'

vi.mock('@/lib/api', () => ({
  systemApi: { status: vi.fn() },
  authApi: { requestPasswordReset: vi.fn(), resetPasswordWithRecoveryCode: vi.fn() },
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ login: vi.fn(), register: vi.fn() }) }))

// 系統狀態（.scratch/system-settings/issues/02）：沒有設定寄信時沒有 email 的忘記密碼（只剩復原碼）；全新安裝時註冊的是管理員。
beforeEach(() => {
  forgetSystemStatus()
  vi.mocked(systemApi.status).mockResolvedValue({ setupRequired: false, mailEnabled: false })
})

describe('without mail set up', () => {
  it('the login page offers resetting with a recovery code', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    expect(await screen.findByRole('link', { name: '忘記密碼？用復原碼重設' })).toHaveAttribute('href', '/forgot-password')
  })

  it('忘記密碼 is only the recovery code, and says why', async () => {
    vi.mocked(authApi.resetPasswordWithRecoveryCode).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)

    expect(await screen.findByText(/這套系統沒有設定寄信/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '寄重設密碼的信' })).toBeNull()
    expect(screen.queryByRole('button', { name: '改用 email 重設' })).toBeNull()
    await user.type(screen.getByLabelText('Email'), 'a@example.com')
    await user.type(screen.getByLabelText('復原碼'), 'aaaaa-bbbbb-ccccc-ddddd')
    await user.type(screen.getByLabelText('新密碼'), 'a brand new password')
    await user.click(screen.getByRole('button', { name: '重設密碼' }))
    expect(authApi.resetPasswordWithRecoveryCode).toHaveBeenCalled()
    expect(authApi.requestPasswordReset).not.toHaveBeenCalled()
  })
})

describe('a fresh install', () => {
  it('registers the administrator first', async () => {
    vi.mocked(systemApi.status).mockResolvedValue({ setupRequired: true, mailEnabled: false })
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)

    expect(await screen.findByText('建立管理員帳號')).toBeInTheDocument()
    expect(screen.getByText(/會成為管理員/)).toBeInTheDocument()
  })

  it('an installation already in use registers ordinary accounts', async () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)

    expect(await screen.findByText('開始上傳並產出逐字稿與摘要')).toBeInTheDocument()
    expect(screen.getByText('建立帳號')).toBeInTheDocument()
  })
})
