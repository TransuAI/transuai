import { apiFetch, apiFetchVoid, requestSse } from '@/lib/api-client'
import type { ModelRef } from '@/lib/providers'
import type {
  AnswerStep,
  AuthResponse,
  AvailableModels,
  Chapter,
  ConfirmedProposal,
  Connection,
  Job,
  JobCategory,
  JobListResponse,
  JobUpdate,
  JobUsage,
  MediaUrlResponse,
  ModelChoice,
  Note,
  NoteSource,
  PostMeeting,
  PostMeetingRun,
  PostMeetingSettings,
  PostMeetingSettingsUpdate,
  MonthlyUsage,
  PresignResponse,
  TranscriptionLanguage,
  ProviderKey,
  Quiz,
  QuizAttemptResult,
  QaTurn,
  SegmentSpeakerUpdate,
  SegmentUpdate,
  SpeakerAssignment,
  SpeakerSuggestion,
  SpeakerUpdate,
  Summary,
  Transcript,
  User,
  WebSearchResult,
} from '@/types/api'

export const authApi = {
  register: (params: { email: string; password: string; displayName: string }) =>
    apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: params, auth: false }),

  login: (params: { email: string; password: string }) =>
    apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: params, auth: false }),

  me: () => apiFetch<User>('/auth/me'),

  // Revokes this sign-in's refresh token (sent as its httpOnly cookie) and clears the cookie; needs no access token
  // (it may have expired).
  logout: () => apiFetchVoid('/auth/logout', { method: 'POST', auth: false }),

  logoutAll: () => apiFetchVoid('/auth/logout-all', { method: 'POST' }),

  // 刪除帳號: the password again (403 when wrong). Everything of the user's is deleted on the server and the refresh-token
  // cookie cleared.
  deleteAccount: (password: string) => apiFetchVoid('/auth/account/delete', { method: 'POST', body: { password } }),
}

export const uploadApi = {
  // durationSeconds lets the gateway refuse a file that won't fit in this month's 用量上限 before it's sent.
  presign: (params: { fileName: string; fileType: 'AUDIO' | 'VIDEO'; fileSizeBytes: number; durationSeconds: number }) =>
    apiFetch<PresignResponse>('/uploads/presign', { method: 'POST', body: params }),

  complete: (params: {
    storagePath: string
    fileName: string
    fileType: 'AUDIO' | 'VIDEO'
    fileSizeBytes: number
    durationSeconds: number
    transcriptionLanguage: TranscriptionLanguage
  }) => apiFetch<Job>('/uploads/complete', { method: 'POST', body: params }),
}

export const jobsApi = {
  // page 從 1 開始。query：標題或檔名包含它的；category：只看某個類型。
  list: (params: { page?: number; pageSize?: number; query?: string; category?: JobCategory } = {}) => {
    const query = new URLSearchParams()
    if (params.page !== undefined) query.set('page', String(params.page))
    if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize))
    if (params.query) query.set('query', params.query)
    if (params.category) query.set('category', params.category)
    const qs = query.toString()
    return apiFetch<JobListResponse>(`/jobs${qs ? `?${qs}` : ''}`)
  },

  get: (jobId: string) => apiFetch<Job>(`/jobs/${jobId}`),

  update: (jobId: string, update: JobUpdate) =>
    apiFetch<Job>(`/jobs/${jobId}`, { method: 'PATCH', body: update }),

  // download: true 要的是「存成原始檔名」的附件 URL（匯出 → 下載原始檔）；預設是給播放器的 inline URL。
  getMediaUrl: (jobId: string, options: { download?: boolean } = {}) =>
    apiFetch<MediaUrlResponse>(`/jobs/${jobId}/media-url${options.download ? '?download=true' : ''}`),

  remove: (jobId: string) => apiFetchVoid(`/jobs/${jobId}`, { method: 'DELETE' }),
}

export const transcriptApi = {
  // 講者分離之前的後端（例如還沒更新的 Gateway）不回傳 speakers，當成沒有講者資訊。
  get: async (jobId: string): Promise<Transcript> => {
    const transcript = await apiFetch<Omit<Transcript, 'speakers'> & { speakers?: Transcript['speakers'] }>(
      `/transcripts/${jobId}`,
    )
    return { ...transcript, speakers: transcript.speakers ?? [] }
  },

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

// 筆記：釘在錄音某個時間（或不釘）的一段文字；只有時間的是書籤。沒有時間的筆記一定要有文字（伺服器會回 400）。
export const notesApi = {
  list: (jobId: string) => apiFetch<Note[]>(`/jobs/${jobId}/notes`),
  create: (jobId: string, note: { timeSeconds?: number; text?: string; source?: NoteSource }) =>
    apiFetch<Note>(`/jobs/${jobId}/notes`, { method: 'POST', body: note }),
  update: (jobId: string, noteId: string, text: string) =>
    apiFetch<Note>(`/jobs/${jobId}/notes/${noteId}`, { method: 'PATCH', body: { text } }),
  remove: (jobId: string, noteId: string) => apiFetchVoid(`/jobs/${jobId}/notes/${noteId}`, { method: 'DELETE' }),
}

// 講者名字建議：pipeline 依錄音裡明確講出的話提的名字。套用＝前端先用 transcriptApi.renameSpeaker 改名，再標成 applied。
export const speakerSuggestionsApi = {
  list: (jobId: string) => apiFetch<SpeakerSuggestion[]>(`/jobs/${jobId}/speaker-suggestions`),
  setStatus: (jobId: string, speakerLabel: string, status: 'applied' | 'dismissed') =>
    apiFetch<SpeakerSuggestion>(`/jobs/${jobId}/speaker-suggestions/${encodeURIComponent(speakerLabel)}`, {
      method: 'PUT',
      body: { status },
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
  /** Which model is answering; arrives once, after the sources. */
  onModel?: (model: ModelChoice) => void
  /** What the web search found; arrives once, between the sources and the model, only when the question searched the web. */
  onWebSources?: (result: WebSearchResult) => void
  /** A step of answering (理解問題, 找段落, 查網路, 撰寫回答); the same step comes again as it moves on. */
  onStep?: (step: AnswerStep) => void
  signal?: AbortSignal
  /** A model for this question only; the default model when omitted. */
  model?: ModelRef
  /** Also search the web for this question (查網路). */
  webSearch?: boolean
}

export const qaApi = {
  history: (jobId: string) => apiFetch<QaTurn[]>(`/qa/${jobId}`),

  // Resolve 不代表「答案正確送達」，只代表串流正常結束——中途失敗會透過 onError 回報一個
  // error event，stream 本身還是乾淨結束（見 ai-service AskQuestion 的設計），呼叫端要自己
  // 用 onError 有沒有被呼叫過來判斷這輪問答到底成不成功，不能只看 promise 有沒有 reject。
  ask: (jobId: string, question: string, handlers: QaStreamHandlers) =>
    requestSse(
      `/qa/${jobId}`,
      {
        method: 'POST',
        body: { question, ...(handlers.model && { model: handlers.model }), ...(handlers.webSearch && { webSearch: true }) },
      },
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
          case 'model':
            handlers.onModel?.(JSON.parse(data) as ModelChoice)
            break
          case 'web_sources':
            handlers.onWebSources?.(JSON.parse(data) as WebSearchResult)
            break
          case 'step':
            handlers.onStep?.(JSON.parse(data) as AnswerStep)
            break
        }
      },
      handlers.signal,
    ),
}

// 測驗：在背景產生（每次多一份新的），產生中的輪詢列表直到不是 GENERATING。
export const quizApi = {
  list: (jobId: string) => apiFetch<Quiz[]>(`/jobs/${jobId}/quizzes`),
  // questionCount 只能是 5、10、20
  request: (jobId: string, questionCount: number) =>
    apiFetch<Quiz>(`/jobs/${jobId}/quizzes`, { method: 'POST', body: { questionCount } }),
  get: (jobId: string, quizId: string) => apiFetch<Quiz>(`/jobs/${jobId}/quizzes/${quizId}`),
  // 後端計分並保存；answers 依題目順序，每題選的選項位置（從 0 開始）
  submitAttempt: (jobId: string, quizId: string, answers: number[]) =>
    apiFetch<QuizAttemptResult>(`/jobs/${jobId}/quizzes/${quizId}/attempts`, { method: 'POST', body: { answers } }),
}

export const usageApi = {
  // 這個 Job 的用量：LLM 呼叫與轉錄，依時間排序，附總計。
  getJobUsage: (jobId: string) => apiFetch<JobUsage>(`/jobs/${jobId}/usage`),
  // 這位使用者某個月（YYYY-MM）依模型加總的用量；省略就是這個月（由伺服器決定，台灣時間）。
  getMonthly: (month?: string) => apiFetch<MonthlyUsage>(month ? `/me/usage?month=${month}` : '/me/usage'),
}

// 會後處理：在背景跑 agent，執行中的輪詢 get 直到不是 RUNNING。timezone 是瀏覽器的 IANA 時區（換算相對日期）。
export const postMeetingApi = {
  get: (jobId: string) => apiFetch<PostMeeting>(`/jobs/${jobId}/post-meeting`),
  start: (jobId: string, timezone: string) =>
    apiFetch<PostMeeting>(`/jobs/${jobId}/post-meeting`, { method: 'POST', body: { timezone } }),
  // 用確認（可能改過）的最終參數執行勾選的提案；沒列出的不執行
  execute: (jobId: string, runId: string, proposals: ConfirmedProposal[]) =>
    apiFetch<PostMeetingRun>(`/jobs/${jobId}/post-meeting/${runId}/execute`, { method: 'POST', body: { proposals } }),
  retry: (jobId: string, runId: string, proposalId: string) =>
    apiFetch<PostMeetingRun>(`/jobs/${jobId}/post-meeting/${runId}/proposals/${proposalId}/retry`, { method: 'POST' }),
}

// 會後處理的設定：Notion 的會議紀錄位置（每場會議建成它底下的子頁面；貼網址，改過時後端先向 Notion 確認；空字串是不指定），
// 以及待辦放在 Notion 會議紀錄裡還是 Google Tasks。
export const postMeetingSettingsApi = {
  get: () => apiFetch<PostMeetingSettings>('/me/post-meeting-settings'),
  update: (settings: PostMeetingSettingsUpdate) =>
    apiFetch<PostMeetingSettings>('/me/post-meeting-settings', { method: 'PUT', body: settings }),
}

// 已連結的帳號（Google、Notion）：權杖只在後端，這裡只看得到狀態。連結時後端給授權網址，由前端把使用者轉過去。
export const connectionsApi = {
  list: () => apiFetch<Connection[]>('/me/connections'),
  authorize: (service: string) => apiFetch<{ authorizeUrl: string }>(`/me/connections/${service}/authorize`),
  // revoked：有沒有成功通知對方撤銷授權（沒有的話權杖一樣已刪除）
  remove: (service: string) => apiFetch<{ revoked: boolean }>(`/me/connections/${service}`, { method: 'DELETE' }),
}

// 自有金鑰：存入前後端會先向廠商驗證；之後只看得到末四碼。
export const providerKeysApi = {
  list: () => apiFetch<ProviderKey[]>('/me/provider-keys'),
  save: (provider: string, key: string) =>
    apiFetch<ProviderKey>(`/me/provider-keys/${provider}`, { method: 'PUT', body: { key } }),
  // defaultModelReset: the default model was using this key and is back on the platform model.
  remove: (provider: string) =>
    apiFetch<{ deleted: boolean; defaultModelReset: boolean }>(`/me/provider-keys/${provider}`, { method: 'DELETE' }),
}

// 預設模型：上傳後的摘要與章節、重新產生、問答都用它。
export const modelsApi = {
  available: () => apiFetch<AvailableModels>('/ai/models'),
  getDefault: () => apiFetch<ModelChoice>('/me/default-model'),
  setDefault: (provider: string, model: string) =>
    apiFetch<ModelChoice>('/me/default-model', { method: 'PUT', body: { provider, model } }),
}
