import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/types/api'
import { ApiError } from '@/lib/api-client'
import { ProtectedRoute } from '@/components/protected-route'
import { SetNewPasswordPage } from './set-new-password-page'

const admin: User = {
  id: 'u1', email: 'admin@example.com', displayName: '管理員', createdAt: '2026-10-18T00:00:00Z',
  emailVerified: false, recoveryCodesLeft: 0, admin: true, mustChangePassword: true,
}
let signedIn: User = admin
const changePassword = vi.fn()
const logout = vi.fn()
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ user: signedIn, isLoading: false, changePassword, logout }),
}))

afterEach(() => {
  vi.clearAllMocks()
  signedIn = admin
})

function openApp(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/set-password" element={<SetNewPasswordPage />} />
          <Route path="/jobs" element={<p>檔案列表</p>} />
          <Route path="/admin/settings" element={<p>系統設定</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

// 安裝時建立的管理員（.scratch/initial-admin）：用 install.sh 印出來的密碼登入後，先換掉密碼才能用別的。
describe('SetNewPasswordPage', () => {
  it('is the only page an administrator on the generated password can open', () => {
    openApp('/admin/settings')

    expect(screen.getByLabelText('安裝時產生的密碼')).toBeInTheDocument()
    expect(screen.queryByText('系統設定')).toBeNull()
  })

  it('replaces the generated password and then opens the app', async () => {
    changePassword.mockImplementation(async () => {
      signedIn = { ...admin, mustChangePassword: false }
    })
    const user = userEvent.setup()
    openApp('/jobs')

    await user.type(screen.getByLabelText('安裝時產生的密碼'), '0f3a9c2e7b1d4f6a8c0e')
    await user.type(screen.getByLabelText('新密碼'), "the admin's own password")
    await user.click(screen.getByRole('button', { name: '設定新密碼' }))

    expect(changePassword).toHaveBeenCalledWith('0f3a9c2e7b1d4f6a8c0e', "the admin's own password")
    expect(await screen.findByText('檔案列表')).toBeInTheDocument()
  })

  it('says so when the generated password is wrong', async () => {
    changePassword.mockRejectedValue(new ApiError(403, { error: 'PERMISSION_DENIED', message: 'wrong password' }))
    const user = userEvent.setup()
    openApp('/set-password')

    await user.type(screen.getByLabelText('安裝時產生的密碼'), 'not it at all')
    await user.type(screen.getByLabelText('新密碼'), "the admin's own password")
    await user.click(screen.getByRole('button', { name: '設定新密碼' }))

    expect(await screen.findByText('安裝時產生的密碼不正確')).toBeInTheDocument()
  })

  it('sends everyone else on to the app', () => {
    signedIn = { ...admin, mustChangePassword: false }
    openApp('/set-password')

    expect(screen.getByText('檔案列表')).toBeInTheDocument()
  })
})
