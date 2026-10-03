import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '@/lib/api'
import { getAccessToken, setAccessToken } from '@/lib/access-token'
import { AuthProvider, useAuth } from './auth-context'

vi.mock('@/lib/api', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(), logoutAll: vi.fn(), deleteAccount: vi.fn() },
}))

const user = { id: 'u1', email: 'a@example.com', displayName: null, createdAt: '2026-09-01T00:00:00Z' }

function Buttons() {
  const { user: signedIn, isLoading, login, logout, logoutEverywhere, deleteAccount } = useAuth()
  if (isLoading) return <span>載入中</span>
  return (
    <>
      <span>{signedIn ? '已登入' : '未登入'}</span>
      <button onClick={() => void login('a@example.com', 'secret-password')}>登入</button>
      <button onClick={logout}>登出</button>
      <button onClick={() => void logoutEverywhere()}>登出所有裝置</button>
      <button onClick={() => void deleteAccount('the-password').catch(() => {})}>刪除帳號</button>
    </>
  )
}

// The gateway's POST /auth/refresh: answers from the httpOnly refresh-token cookie, which JavaScript never sees.
function refreshCookie(valid: boolean) {
  const fetchMock = vi.fn(async () =>
    valid
      ? new Response(JSON.stringify({ accessToken: 'access-from-cookie', user }), { status: 200 })
      : new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.mocked(authApi.login).mockResolvedValue({ accessToken: 'access-from-login', user })
  vi.mocked(authApi.logout).mockResolvedValue(undefined)
  vi.mocked(authApi.logoutAll).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  setAccessToken(null)
})

describe('signing back in on page load', () => {
  it('uses the refresh-token cookie and keeps the access token only in memory', async () => {
    const fetchMock = refreshCookie(true)
    render(<AuthProvider><Buttons /></AuthProvider>)

    expect(await screen.findByText('已登入')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/refresh$/), { method: 'POST' })
    expect(getAccessToken()).toBe('access-from-cookie')
    expect(localStorage.length).toBe(0)
  })

  it('is signed out when the cookie is missing or no longer valid', async () => {
    refreshCookie(false)
    render(<AuthProvider><Buttons /></AuthProvider>)

    expect(await screen.findByText('未登入')).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })

  it('forgets tokens an older version stored in localStorage', async () => {
    localStorage.setItem('transuai.accessToken', 'old-access')
    localStorage.setItem('transuai.refreshToken', 'old-refresh')
    localStorage.setItem('transuai.user', JSON.stringify(user))
    localStorage.setItem('theme', 'dark')
    refreshCookie(false)
    render(<AuthProvider><Buttons /></AuthProvider>)

    await screen.findByText('未登入')
    expect(localStorage.getItem('transuai.accessToken')).toBeNull()
    expect(localStorage.getItem('transuai.refreshToken')).toBeNull()
    expect(localStorage.getItem('transuai.user')).toBeNull()
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})

describe('logging in', () => {
  it('keeps the access token in memory, not in storage', async () => {
    refreshCookie(false)
    const clicker = userEvent.setup()
    render(<AuthProvider><Buttons /></AuthProvider>)
    await screen.findByText('未登入')

    await clicker.click(screen.getByRole('button', { name: '登入' }))

    expect(await screen.findByText('已登入')).toBeInTheDocument()
    expect(getAccessToken()).toBe('access-from-login')
    expect(localStorage.length).toBe(0)
  })
})

describe('logging out (登出)', () => {
  it('tells the server to revoke the refresh token and forgets the access token', async () => {
    refreshCookie(true)
    const clicker = userEvent.setup()
    render(<AuthProvider><Buttons /></AuthProvider>)
    await screen.findByText('已登入')

    await clicker.click(screen.getByRole('button', { name: '登出' }))

    expect(authApi.logout).toHaveBeenCalled()
    expect(screen.getByText('未登入')).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })

  it('still logs out here when the server cannot be reached', async () => {
    vi.mocked(authApi.logout).mockRejectedValue(new Error('network'))
    refreshCookie(true)
    const clicker = userEvent.setup()
    render(<AuthProvider><Buttons /></AuthProvider>)
    await screen.findByText('已登入')

    await clicker.click(screen.getByRole('button', { name: '登出' }))

    expect(screen.getByText('未登入')).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })

  it('logs out of every device, then this one', async () => {
    refreshCookie(true)
    const clicker = userEvent.setup()
    render(<AuthProvider><Buttons /></AuthProvider>)
    await screen.findByText('已登入')

    await clicker.click(screen.getByRole('button', { name: '登出所有裝置' }))

    await waitFor(() => expect(screen.getByText('未登入')).toBeInTheDocument())
    expect(authApi.logoutAll).toHaveBeenCalled()
    expect(getAccessToken()).toBeNull()
  })
})

describe('deleting the account (刪除帳號)', () => {
  it('asks the server with the password, then forgets the access token and signs out', async () => {
    vi.mocked(authApi.deleteAccount).mockResolvedValue(undefined)
    refreshCookie(true)
    const clicker = userEvent.setup()
    render(<AuthProvider><Buttons /></AuthProvider>)
    await screen.findByText('已登入')

    await clicker.click(screen.getByRole('button', { name: '刪除帳號' }))

    await waitFor(() => expect(screen.getByText('未登入')).toBeInTheDocument())
    expect(authApi.deleteAccount).toHaveBeenCalledWith('the-password')
    expect(getAccessToken()).toBeNull()
  })

  it('stays signed in when the server refuses', async () => {
    vi.mocked(authApi.deleteAccount).mockRejectedValue(new Error('wrong password'))
    refreshCookie(true)
    const clicker = userEvent.setup()
    render(<AuthProvider><Buttons /></AuthProvider>)
    await screen.findByText('已登入')

    await clicker.click(screen.getByRole('button', { name: '刪除帳號' }))

    expect(screen.getByText('已登入')).toBeInTheDocument()
    expect(getAccessToken()).toBe('access-from-cookie')
  })
})
