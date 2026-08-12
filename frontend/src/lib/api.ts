import { apiFetch, apiFetchVoid } from '@/lib/api-client'
import type {
  AuthResponse,
  Chapter,
  Job,
  JobListResponse,
  PresignResponse,
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

  remove: (jobId: string) => apiFetchVoid(`/jobs/${jobId}`, { method: 'DELETE' }),
}

export const transcriptApi = {
  get: (jobId: string) => apiFetch<Transcript>(`/transcripts/${jobId}`),
}

export const summaryApi = {
  get: (jobId: string) => apiFetch<Summary>(`/summary/${jobId}`),
}

export const chapterApi = {
  list: (jobId: string) => apiFetch<Chapter[]>(`/chapters/${jobId}`),
}
