import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/layout/sidebar'
import { LoginPage } from './login-page'
import { RegisterPage } from './register-page'

const login = vi.fn()
const register = vi.fn()
const logout = vi.fn()
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({
    login,
    register,
    logout,
    user: { id: 'u1', email: 'a@example.com', displayName: '王小明', createdAt: '2026-10-18T00:00:00Z', emailVerified: true,
      recoveryCodesLeft: 0, admin: false, mustChangePassword: false },
  }),
}))
vi.mock('@/lib/api', () => ({
  systemApi: { status: vi.fn().mockResolvedValue({ setupRequired: false, mailEnabled: true }) },
}))

afterEach(() => {
  vi.clearAllMocks()
})

function at(path: string, page: React.ReactElement) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={page} />
        <Route path="/jobs" element={<p>檔案列表</p>} />
        <Route path="/login" element={<p>登入頁</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

// 登入、註冊成功後到檔案列表；登出後回登入頁。
describe('where signing in and out leads', () => {
  it('signing in opens the file list', async () => {
    login.mockResolvedValue(undefined)
    const user = userEvent.setup()
    at('/sign-in', <LoginPage />)

    await user.type(await screen.findByLabelText('Email'), 'a@example.com')
    await user.type(screen.getByLabelText('密碼'), 'a good password')
    await user.click(screen.getByRole('button', { name: '登入' }))

    expect(login).toHaveBeenCalledWith('a@example.com', 'a good password')
    expect(await screen.findByText('檔案列表')).toBeInTheDocument()
  })

  it('signing up opens the file list', async () => {
    register.mockResolvedValue(undefined)
    const user = userEvent.setup()
    at('/sign-up', <RegisterPage />)

    await user.type(await screen.findByLabelText('顯示名稱'), '王小明')
    await user.type(screen.getByLabelText('Email'), 'a@example.com')
    await user.type(screen.getByLabelText('密碼'), 'a good password')
    await user.click(screen.getByRole('button', { name: '註冊' }))

    expect(register).toHaveBeenCalledWith('a@example.com', 'a good password', '王小明')
    expect(await screen.findByText('檔案列表')).toBeInTheDocument()
  })

  it('signing out goes back to the sign-in page', async () => {
    const user = userEvent.setup()
    at('/home', <Sidebar />)

    await user.click(screen.getByRole('button', { name: /王小明/ }))
    await user.click(await screen.findByRole('menuitem', { name: '登出' }))

    expect(logout).toHaveBeenCalled()
    expect(await screen.findByText('登入頁')).toBeInTheDocument()
  })
})
