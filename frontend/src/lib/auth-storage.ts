import type { User } from '@/types/api'

const ACCESS_TOKEN_KEY = 'transuai.accessToken'
const REFRESH_TOKEN_KEY = 'transuai.refreshToken'
const USER_KEY = 'transuai.user'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  user: User
}

export function loadSession(): StoredSession | null {
  const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY)
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
  const userRaw = localStorage.getItem(USER_KEY)
  if (!accessToken || !refreshToken || !userRaw) return null
  try {
    return { accessToken, refreshToken, user: JSON.parse(userRaw) as User }
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession) {
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
}

export function updateTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}
