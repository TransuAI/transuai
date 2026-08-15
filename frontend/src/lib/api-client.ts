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

function buildHeaders(auth: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) {
    const session = loadSession()
    if (session) headers.Authorization = `Bearer ${session.accessToken}`
  }
  return headers
}

// 送出請求，401 時嘗試 refresh 一次再重打；不對 res.ok 做任何假設，交給呼叫端決定——
// request() 跟 requestSse() 對「不 ok 怎麼辦」的處理不一樣（後者還要檢查 res.body）。
async function fetchWithAuthRetry(
  path: string,
  options: RequestOptions,
  signal?: AbortSignal,
): Promise<Response> {
  const { method = 'GET', body, auth = true } = options

  const doFetch = () =>
    fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: buildHeaders(auth),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })

  let res = await doFetch()

  if (res.status === 401 && auth) {
    const newAccessToken = await refreshAccessToken()
    if (newAccessToken) {
      res = await doFetch()
    } else {
      clearSession()
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    }
  }

  return res
}

// 送出請求、處理 401 refresh 與錯誤 status，回傳「已確認 res.ok」的 raw Response。
// 要不要 parse body 交給呼叫端決定，這裡不對 body 做任何假設。
async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const res = await fetchWithAuthRetry(path, options)
  if (!res.ok) {
    const errBody = await safeParseError(res)
    throw new ApiError(res.status, errBody)
  }
  return res
}

// 讀 SSE（Server-Sent Events）串流，逐個 frame 呼叫 onEvent。刻意不用瀏覽器原生的
// EventSource——它沒辦法附加 Authorization header，這個 API 全部端點都是 Bearer JWT 驗證，
// 只能自己用 fetch + ReadableStream 手動解析。data 欄位預期一律是後端已經 JSON encode 過的
// 單行字串（見 gateway AiController 的註解），呼叫端自己 JSON.parse。
export async function requestSse(
  path: string,
  options: RequestOptions,
  onEvent: (event: string, data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetchWithAuthRetry(path, options, signal)
  if (!res.ok || !res.body) {
    const errBody = await safeParseError(res)
    throw new ApiError(res.status, errBody)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let frameEnd = buffer.indexOf('\n\n')
    while (frameEnd !== -1) {
      parseSseFrame(buffer.slice(0, frameEnd), onEvent)
      buffer = buffer.slice(frameEnd + 2)
      frameEnd = buffer.indexOf('\n\n')
    }
  }
}

function parseSseFrame(frame: string, onEvent: (event: string, data: string) => void) {
  let eventName = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length > 0) onEvent(eventName, dataLines.join('\n'))
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
