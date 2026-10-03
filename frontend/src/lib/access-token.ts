// access token 只放在記憶體：不放 localStorage，XSS 就偷不到存起來的 token。重新整理頁面之後就沒了，靠 httpOnly cookie 裡的
// refresh token（JavaScript 讀不到，見 gateway 的 RefreshTokenCookie）換一個新的——見 api-client 的 refreshSession。
let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null) {
  accessToken = token
}

// 舊版把 token 與使用者存在 localStorage；啟動時清掉，不留可以被偷的 token。
const LEGACY_STORAGE_KEYS = ['transuai.accessToken', 'transuai.refreshToken', 'transuai.user']

export function forgetLegacyStoredSession() {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
  } catch {
    // storage blocked: nothing could have been stored there either
  }
}
