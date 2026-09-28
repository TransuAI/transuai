import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '@/lib/api'
import { getRefreshToken, loadSession, saveSession } from '@/lib/auth-storage'
import { AuthProvider, useAuth } from './auth-context'

vi.mock('@/lib/api', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(), logoutAll: vi.fn() },
}))

const user = { id: 'u1', email: 'a@example.com', displayName: null, createdAt: '2026-09-01T00:00:00Z' }

function Buttons() {
  const { user: signedIn, logout, logoutEverywhere } = useAuth()
  return (
    <>
      <span>{signedIn ? '已登入' : '未登入'}</span>
      <button onClick={logout}>登出</button>
      <button onClick={() => void logoutEverywhere()}>登出所有裝置</button>
    </>
  )
}

beforeEach(() => {
  saveSession({ accessToken: 'access', refreshToken: 'refresh-1', user })
  vi.mocked(authApi.me).mockResolvedValue(user)
  vi.mocked(authApi.logout).mockResolvedValue(undefined)
  vi.mocked(authApi.logoutAll).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('logging out (登出)', () => {
  it('tells the server to revoke the refresh token and forgets the session', async () => {
    const clicker = userEvent.setup()
    render(<AuthProvider><Buttons /></AuthProvider>)
    await screen.findByText('已登入')

    await clicker.click(screen.getByRole('button', { name: '登出' }))

    expect(authApi.logout).toHaveBeenCalledWith('refresh-1')
    expect(screen.getByText('未登入')).toBeInTheDocument()
    expect(loadSession()).toBeNull()
  })

  it('still logs out here when the server cannot be reached', async () => {
    vi.mocked(authApi.logout).mockRejectedValue(new Error('network'))
    const clicker = userEvent.setup()
    render(<AuthProvider><Buttons /></AuthProvider>)
    await screen.findByText('已登入')

    await clicker.click(screen.getByRole('button', { name: '登出' }))

    expect(screen.getByText('未登入')).toBeInTheDocument()
    expect(getRefreshToken()).toBeNull()
  })

  it('logs out of every device, then this one', async () => {
    const clicker = userEvent.setup()
    render(<AuthProvider><Buttons /></AuthProvider>)
    await screen.findByText('已登入')

    await clicker.click(screen.getByRole('button', { name: '登出所有裝置' }))

    await waitFor(() => expect(screen.getByText('未登入')).toBeInTheDocument())
    expect(authApi.logoutAll).toHaveBeenCalled()
    expect(loadSession()).toBeNull()
  })
})
