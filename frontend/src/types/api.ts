export type JobStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'TRANSCRIBING'
  | 'TRANSCRIBED'
  | 'SUMMARIZING'
  | 'COMPLETED'
  | 'FAILED'

export type FileType = 'AUDIO' | 'VIDEO'

export interface User {
  id: string
  email: string
  displayName: string | null
  createdAt: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: User
}

export interface Job {
  jobId: string
  userId: string
  fileName: string
  fileType: FileType
  fileSizeBytes: number
  storagePath: string
  durationSeconds: number
  status: JobStatus
  errorReason: string | null
  createdAt: string
  updatedAt: string
}

export interface JobListResponse {
  jobs: Job[]
  totalCount: number
  page: number
  pageSize: number
}

export interface PresignResponse {
  uploadUrl: string
  storagePath: string
  expiresAt: string
}

export interface TranscriptSegment {
  startTime: number
  endTime: number
  speakerLabel: string | null
  text: string
}

export interface Transcript {
  jobId: string
  language: string | null
  fullText: string
  segments: TranscriptSegment[]
}

export interface Summary {
  jobId: string
  summaryText: string
}

export interface ApiErrorBody {
  error: string
  message: string
}

export interface JobStatusEvent {
  jobId: string
  status: JobStatus
  progress?: number
  stage?: string
  errorReason?: string
}
