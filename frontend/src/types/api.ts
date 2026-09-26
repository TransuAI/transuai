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

export interface MediaUrlResponse {
  downloadUrl: string
  expiresAt: string
}

export interface TranscriptSegment {
  id: string
  startTime: number
  endTime: number
  speakerLabel: string | null
  /** Current text; an empty string is a cleared segment (已清空片段). */
  text: string
  /** The machine output before any edit (原始文字), for restoring. */
  originalText: string
}

export interface Transcript {
  jobId: string
  language: string | null
  fullText: string
  segments: TranscriptSegment[]
  /** +1 on every edit — what an AI output's source revision is checked against to tell whether it's 過時. */
  revision: number
}

export interface SegmentUpdate {
  segment: TranscriptSegment
  revision: number
}

export interface Summary {
  jobId: string
  summaryText: string
  /** The transcript revision this summary (and its chapters) was built from. */
  sourceRevision: number
  /** State of a user-requested regeneration of the summary and chapters. */
  regenerationStatus: 'IDLE' | 'RUNNING' | 'FAILED'
}

export interface Chapter {
  id: string
  jobId: string
  title: string
  startTime: number
  sequenceNo: number
}

// 一個 job 底下的一筆問答紀錄；「對話」的範圍就是整個 job，沒有獨立的 conversation/thread
// 概念，見 ai-service/docs/adr/ 對話範圍的 ADR。
export interface QaTurn {
  question: string
  answer: string
  sourceTimestamps: number[]
  createdAt: string
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
