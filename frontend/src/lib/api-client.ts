import type { ApiErrorBody } from '@/types/api'
import { clearSession, getRefreshToken, loadSession, updateTokens } from '@/lib/auth-storage'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

export const SESSION_EXPIRED_EVENT = 'transuai:session-expired'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || body.error)
    this.status = status
    this.code = body.error
  }
}

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return null

    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { accessToken: string; refreshToken: string }
      updateTokens(data.accessToken, data.refreshToken)
      return data.accessToken
    } catch {
      return null
    }
  })()

  const result = await refreshPromise
  refreshPromise = null
  return result
}

interface RequestOptions {
  method?: string
  body?: unknown
  auth?: boolean
}

// 送出請求、處理 401 refresh 與錯誤 status，回傳「已確認 res.ok」的 raw Response。
// 要不要 parse body 交給呼叫端決定，這裡不對 body 做任何假設。
async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', body, auth = true } = options

  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth) {
      const session = loadSession()
      if (session) headers.Authorization = `Bearer ${session.accessToken}`
    }
    return fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  let res = await doFetch()

  if (res.status === 401 && auth) {
    const newAccessToken = await refreshAccessToken()
    if (newAccessToken) {
      res = await doFetch()
    } else {
      clearSession()
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      const errBody = await safeParseError(res)
      throw new ApiError(401, errBody)
    }
  }

  if (!res.ok) {
    const errBody = await safeParseError(res)
    throw new ApiError(res.status, errBody)
  }

  return res
}

// 給「回應一定有 JSON body」的端點用。
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await request(path, options)
  return (await res.json()) as T
}

// 給「回應不會有 body」的端點用（例如 DELETE）。呼叫端明確宣告不期待 body，
// 這裡就不會去嘗試 res.json()，不管後端實際回的 status 是 204 還是帶空 body 的 200。
export async function apiFetchVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await request(path, options)
}

async function safeParseError(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody
  } catch {
    return { error: 'UNKNOWN', message: res.statusText || '發生未知錯誤' }
  }
}

export function uploadToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`上傳檔案失敗（${xhr.status}）`))
      }
    }

    xhr.onerror = () => reject(new Error('上傳檔案時發生網路錯誤'))
    xhr.send(file)
  })
}
