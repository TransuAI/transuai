import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi } from '@/lib/api'
import { ApiError, SESSION_EXPIRED_EVENT } from '@/lib/api-client'
import { clearSession, getRefreshToken, loadSession, saveSession } from '@/lib/auth-storage'
import type { User } from '@/types/api'

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => void
  /** Signs out every device (revokes all refresh tokens), then this one. */
  logoutEverywhere: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => loadSession()?.user ?? null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const session = loadSession()
    if (!session) {
      setIsLoading(false)
      return
    }
    authApi
      .me()
      .then((freshUser) => setUser(freshUser))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession()
          setUser(null)
        }
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    const handleExpired = () => setUser(null)
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password })
    saveSession(res)
    setUser(res.user)
  }, [])

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const res = await authApi.register({ email, password, displayName })
    saveSession(res)
    setUser(res.user)
  }, [])

  // Signing out here doesn't wait for the server: the refresh token is revoked there if it can be, and forgotten here
  // regardless.
  const logout = useCallback(() => {
    const refreshToken = getRefreshToken()
    if (refreshToken) void authApi.logout(refreshToken).catch(() => {})
    clearSession()
    setUser(null)
  }, [])

  const logoutEverywhere = useCallback(async () => {
    await authApi.logoutAll()
    clearSession()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout, logoutEverywhere }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
