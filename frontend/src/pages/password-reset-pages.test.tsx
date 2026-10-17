import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { ForgotPasswordPage } from './forgot-password-page'
import { LoginPage } from './login-page'
import { ResetPasswordPage } from './reset-password-page'

vi.mock('@/lib/api', () => ({ authApi: { requestPasswordReset: vi.fn(), resetPassword: vi.fn() } }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ login: vi.fn() }) }))

afterEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

// 忘記密碼（.scratch/pre-launch-hardening/issues/19）：寄重設連結、用連結設新密碼。
describe('LoginPage', () => {
  it('links to 忘記密碼', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    expect(screen.getByRole('link', { name: '忘記密碼？' })).toHaveAttribute('href', '/forgot-password')
  })
})

describe('ForgotPasswordPage', () => {
  it('sends the link and says it comes only if the email is registered', async () => {
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)

    await user.type(screen.getByLabelText('Email'), 'a@example.com')
    await user.click(screen.getByRole('button', { name: '寄重設密碼的信' }))

    expect(authApi.requestPasswordReset).toHaveBeenCalledWith('a@example.com')
    expect(await screen.findByRole('status')).toHaveTextContent('如果 a@example.com 有註冊，幾分鐘內會收到重設密碼的信')
  })

  it("says why it can't, such as no mail set up on this installation", async () => {
    vi.mocked(authApi.requestPasswordReset).mockRejectedValue(new ApiError(503, {
      error: 'UNAVAILABLE', message: '這個系統沒有設定寄信，不能用「忘記密碼」；請洽管理這套系統的人員重設密碼',
    }))
    const user = userEvent.setup()
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)

    await user.type(screen.getByLabelText('Email'), 'a@example.com')
    await user.click(screen.getByRole('button', { name: '寄重設密碼的信' }))

    expect(await screen.findByText(/沒有設定寄信/)).toBeInTheDocument()
  })
})

describe('ResetPasswordPage', () => {
  function openLink(hash: string) {
    window.history.replaceState(null, '', `/reset-password${hash}`)
    render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>)
  }

  it('sets the new password with the token from the link, taking the token out of the address bar', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue(undefined)
    const user = userEvent.setup()
    openLink('#token=abc123')
    expect(window.location.hash).toBe('')

    await user.type(screen.getByLabelText('新密碼'), 'a brand new password')
    await user.click(screen.getByRole('button', { name: '重設密碼' }))

    expect(authApi.resetPassword).toHaveBeenCalledWith({ token: 'abc123', newPassword: 'a brand new password' })
    expect(await screen.findByRole('status')).toHaveTextContent('密碼已重設，請用新密碼登入')
    expect(screen.getByRole('link', { name: '登入' })).toHaveAttribute('href', '/login')
  })

  it('offers to ask again when the link is used up or expired', async () => {
    vi.mocked(authApi.resetPassword).mockRejectedValue(new ApiError(409, {
      error: 'FAILED_PRECONDITION', message: '這個重設連結無效或已過期，請重新申請',
    }))
    const user = userEvent.setup()
    openLink('#token=old')

    await user.type(screen.getByLabelText('新密碼'), 'a brand new password')
    await user.click(screen.getByRole('button', { name: '重設密碼' }))

    expect(await screen.findByText(/這個重設連結無效或已過期/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '重新申請' })).toHaveAttribute('href', '/forgot-password')
  })

  it('says the link is incomplete without a token', () => {
    openLink('')

    expect(screen.getByRole('alert')).toHaveTextContent('這個連結不完整')
    expect(screen.queryByLabelText('新密碼')).toBeNull()
  })
})
