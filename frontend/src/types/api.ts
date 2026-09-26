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
  /** The 講者 who says this segment (a label in `Transcript.speakers`); null when the transcript has no speaker information. */
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
  /** The job's speakers (講者) in display order; empty when the transcript has no speaker information. */
  speakers: Speaker[]
}

export interface Speaker {
  label: string
  /** What to show: the user's name for the speaker, or the default 「講者 N」. */
  displayName: string
  /** Starts at 1; picks the speaker's colour. */
  displayOrder: number
}

export interface SegmentUpdate {
  segment: TranscriptSegment
  revision: number
}

export interface SpeakerUpdate {
  speaker: Speaker
  revision: number
}

/** Who a segment goes to: an existing speaker, or a new one (an empty name means 「講者 N」). */
export type SpeakerAssignment = { speakerLabel: string } | { newSpeaker: { name: string } }

export interface SegmentSpeakerUpdate {
  segment: TranscriptSegment
  /** All of the job's speakers, including one that was just added. */
  speakers: Speaker[]
  revision: number
}

export interface Summary {
  jobId: string
  summaryText: string
  /** The transcript revision this summary (and its chapters) was built from. */
  sourceRevision: number
  /** State of a user-requested regeneration of the summary and chapters. */
  regenerationStatus: 'IDLE' | 'RUNNING' | 'FAILED'
  /** The model that made this summary and its chapters ("platform" is 平台模型); null for summaries made before models were recorded. */
  modelProvider: string | null
  model: string | null
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

/** One billed call (用量): an LLM call counts tokens, a transcription counts audio seconds. */
export interface UsageRecord {
  kind: 'llm' | 'transcription'
  /** What the call was for, e.g. summary, chapters, qa_answer, qa_rewrite, regenerated_summary, transcription. */
  feature: string
  provider: string
  model: string
  /** platform (平台模型) or own_key (自有金鑰). */
  keySource: string
  /** null when the provider didn't report it (unknown, not zero). */
  inputTokens: number | null
  outputTokens: number | null
  audioSeconds: number | null
  succeeded: boolean
  createdAt: string
}

export interface JobUsage {
  /** Oldest first. */
  records: UsageRecord[]
  /** Sums of the known numbers. */
  totals: { inputTokens: number; outputTokens: number; audioSeconds: number }
}

/** One of the user's own API keys (自有金鑰): only its last four characters ever come back. */
export interface ProviderKey {
  /** openai / anthropic / gemini / openrouter */
  provider: string
  last4: string
  createdAt: string
}

/** A model the user can pick: provider is "platform" (平台模型) or an AI provider. */
export interface ModelChoice {
  provider: string
  model: string
  /** Whether it can call tools (needed for 會後處理). */
  supportsTools: boolean
}

export interface AvailableModels {
  models: ModelChoice[]
  /** With an OpenRouter key, any OpenRouter model ID can be typed in. */
  openrouterCustom: boolean
}
