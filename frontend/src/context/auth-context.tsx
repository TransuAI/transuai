import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi } from '@/lib/api'
import { refreshSession, SESSION_EXPIRED_EVENT } from '@/lib/api-client'
import { forgetLegacyStoredSession, setAccessToken } from '@/lib/access-token'
import type { User } from '@/types/api'

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => void
  /** Signs out every device (revokes all refresh tokens), then this one. */
  logoutEverywhere: () => Promise<void>
  /** Deletes the account (confirmed with the password), then signs out here. */
  deleteAccount: (password: string) => Promise<void>
  /** Changes the password (confirmed with the current one); other devices are signed out, this one stays signed in. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // The access token lives only in memory, so every page load signs back in with the refresh-token cookie.
  useEffect(() => {
    forgetLegacyStoredSession()
    let cancelled = false
    refreshSession()
      .then((session) => {
        if (!cancelled) setUser(session?.user ?? null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleExpired = () => setUser(null)
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password })
    setAccessToken(res.accessToken)
    setUser(res.user)
  }, [])

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const res = await authApi.register({ email, password, displayName })
    setAccessToken(res.accessToken)
    setUser(res.user)
  }, [])

  // Signing out here doesn't wait for the server: the refresh token is revoked (and its cookie cleared) there if it can
  // be, and the access token is forgotten here regardless.
  const logout = useCallback(() => {
    void authApi.logout().catch(() => {})
    setAccessToken(null)
    setUser(null)
  }, [])

  const logoutEverywhere = useCallback(async () => {
    await authApi.logoutAll()
    setAccessToken(null)
    setUser(null)
  }, [])

  const deleteAccount = useCallback(async (password: string) => {
    await authApi.deleteAccount(password)
    setAccessToken(null)
    setUser(null)
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await authApi.changePassword({ currentPassword, newPassword })
    setAccessToken(res.accessToken)
    setUser(res.user)
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, register, logout, logoutEverywhere, deleteAccount, changePassword }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
