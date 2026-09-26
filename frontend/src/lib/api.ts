import { apiFetch, apiFetchVoid, requestSse } from '@/lib/api-client'
import type {
  AuthResponse,
  Chapter,
  Job,
  JobListResponse,
  MediaUrlResponse,
  PresignResponse,
  QaTurn,
  SegmentSpeakerUpdate,
  SegmentUpdate,
  SpeakerAssignment,
  SpeakerUpdate,
  Summary,
  Transcript,
  User,
} from '@/types/api'

export const authApi = {
  register: (params: { email: string; password: string; displayName: string }) =>
    apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: params, auth: false }),

  login: (params: { email: string; password: string }) =>
    apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: params, auth: false }),

  me: () => apiFetch<User>('/auth/me'),
}

export const uploadApi = {
  presign: (params: { fileName: string; fileType: 'AUDIO' | 'VIDEO'; fileSizeBytes: number }) =>
    apiFetch<PresignResponse>('/uploads/presign', { method: 'POST', body: params }),

  complete: (params: {
    storagePath: string
    fileName: string
    fileType: 'AUDIO' | 'VIDEO'
    fileSizeBytes: number
    durationSeconds: number
  }) => apiFetch<Job>('/uploads/complete', { method: 'POST', body: params }),
}

export const jobsApi = {
  list: (params: { page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams()
    if (params.page !== undefined) query.set('page', String(params.page))
    if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize))
    const qs = query.toString()
    return apiFetch<JobListResponse>(`/jobs${qs ? `?${qs}` : ''}`)
  },

  get: (jobId: string) => apiFetch<Job>(`/jobs/${jobId}`),

  // download: true 要的是「存成原始檔名」的附件 URL（匯出 → 下載原始檔）；預設是給播放器的 inline URL。
  getMediaUrl: (jobId: string, options: { download?: boolean } = {}) =>
    apiFetch<MediaUrlResponse>(`/jobs/${jobId}/media-url${options.download ? '?download=true' : ''}`),

  remove: (jobId: string) => apiFetchVoid(`/jobs/${jobId}`, { method: 'DELETE' }),
}

export const transcriptApi = {
  get: (jobId: string) => apiFetch<Transcript>(`/transcripts/${jobId}`),

  // 編輯片段文字：空字串＝清空、送回 originalText＝還原。
  updateSegmentText: (jobId: string, segmentId: string, text: string) =>
    apiFetch<SegmentUpdate>(`/transcripts/${jobId}/segments/${segmentId}`, { method: 'PATCH', body: { text } }),

  // 替講者命名，空字串＝恢復預設名稱「講者 N」。
  renameSpeaker: (jobId: string, label: string, name: string) =>
    apiFetch<SpeakerUpdate>(`/transcripts/${jobId}/speakers/${encodeURIComponent(label)}`, {
      method: 'PATCH',
      body: { name },
    }),

  // 把片段改成另一位講者，或新增一位講者給它。
  assignSegmentSpeaker: (jobId: string, segmentId: string, assignment: SpeakerAssignment) =>
    apiFetch<SegmentSpeakerUpdate>(`/transcripts/${jobId}/segments/${segmentId}/speaker`, {
      method: 'PUT',
      body: assignment,
    }),
}

export const summaryApi = {
  get: (jobId: string) => apiFetch<Summary>(`/summary/${jobId}`),

  // 在背景依最新逐字稿重新產生摘要與章節；回傳目前的摘要（regenerationStatus 通常是 RUNNING）。
  regenerate: (jobId: string) => apiFetch<Summary>(`/summary/${jobId}/regenerate`, { method: 'POST' }),
}

export const chapterApi = {
  list: (jobId: string) => apiFetch<Chapter[]>(`/chapters/${jobId}`),
}

export interface QaStreamHandlers {
  onSources: (sourceTimestamps: number[]) => void
  onDelta: (text: string) => void
  onError: (message: string) => void
  signal?: AbortSignal
}

export const qaApi = {
  history: (jobId: string) => apiFetch<QaTurn[]>(`/qa/${jobId}`),

  // Resolve 不代表「答案正確送達」，只代表串流正常結束——中途失敗會透過 onError 回報一個
  // error event，stream 本身還是乾淨結束（見 ai-service AskQuestion 的設計），呼叫端要自己
  // 用 onError 有沒有被呼叫過來判斷這輪問答到底成不成功，不能只看 promise 有沒有 reject。
  ask: (jobId: string, question: string, handlers: QaStreamHandlers) =>
    requestSse(
      `/qa/${jobId}`,
      { method: 'POST', body: { question } },
      (event, data) => {
        switch (event) {
          case 'sources':
            handlers.onSources(JSON.parse(data) as number[])
            break
          case 'delta':
            handlers.onDelta(JSON.parse(data) as string)
            break
          case 'error':
            handlers.onError(JSON.parse(data) as string)
            break
        }
      },
      handlers.signal,
    ),
}
