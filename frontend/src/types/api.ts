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
  /** Confirmed by the link mailed at sign-up; 忘記密碼 mails only confirmed addresses. */
  emailVerified: boolean
  /** 復原碼 not used yet (0: never made, or all used). */
  recoveryCodesLeft: number
}

/** 登入、註冊、換發的回應。refresh token 不在這裡：gateway 把它放在 httpOnly cookie。 */
export interface AuthResponse {
  accessToken: string
  user: User
}

/** 轉錄語言: zh-TW 中文(預設)、en 英文、auto 請語音辨識在中文與英文之間自動偵測。 */
export type TranscriptionLanguage = 'zh-TW' | 'en' | 'auto'

/** A job's category (類型): judged by the AI from the content, changeable by the user. */
export type JobCategory = 'meeting' | 'lecture' | 'interview' | 'podcast' | 'video' | 'other'

/** 使用者改標題／類型：只帶要改的欄位；標題空字串＝清空（顯示檔名）。改過的 AI 之後不會再寫。 */
export interface JobUpdate {
  title?: string
  category?: JobCategory
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
  transcriptionLanguage: TranscriptionLanguage
  /** 標題: the AI's or the user's; null (or absent, from older gateways) shows the file name instead. */
  title?: string | null
  category?: JobCategory | null
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

/** Where a note came from: written by the user, or an answer saved from 問答. */
export type NoteSource = 'manual' | 'qa'

/** 筆記: the user's text, pinned to a time in the recording or not; with a time and no text it's a bookmark (書籤). */
export interface Note {
  noteId: string
  jobId: string
  /** Seconds into the recording; null when not pinned. */
  timeSeconds: number | null
  text: string
  source: NoteSource
  createdAt: string
  updatedAt: string
}

/** 講者名字建議: a name the recording itself gives a speaker, with the line that says so. */
export interface SpeakerSuggestion {
  speakerLabel: string
  name: string
  evidenceStartTime: number
  evidenceText: string
  status: 'pending' | 'applied' | 'dismissed'
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
  /** The model that answered ("platform" is 平台模型); null for answers from before models were recorded. */
  modelProvider: string | null
  model: string | null
  /** Whether this question also searched the web (查網路); absent from gateways that predate it. */
  webSearch?: boolean
  /** The web pages the answer drew on, numbered as the answer's [1], [2]…; empty when the search failed. */
  webSources?: WebSource[]
}

/** A web page an answer drew on (網路來源, see ai-service CONTEXT.md). */
export interface WebSource {
  title: string
  url: string
}

/** One step of answering a question (見 ai.proto AnswerStep), shown while it happens; the same id comes again as it moves on. */
export interface AnswerStep {
  /** understand / retrieve / search / answer */
  id: string
  label: string
  state: 'running' | 'done' | 'failed'
  detail: string
}

/** What a question's web search found; `failed` when the search didn't go through and the answer uses the content only. */
export interface WebSearchResult {
  sources: WebSource[]
  failed: boolean
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

/** One billed call (用量): an LLM call counts tokens, a transcription counts audio seconds, a web search just counts once. */
export interface UsageRecord {
  kind: 'llm' | 'transcription' | 'web_search'
  /** What the call was for, e.g. summary, chapters, qa_answer, qa_rewrite, regenerated_summary, quiz, post_meeting, transcription. */
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
  /** Sums of the known numbers; webSearches counts the searches that went through (absent from older gateways). */
  totals: { inputTokens: number; outputTokens: number; audioSeconds: number; webSearches?: number }
}

/** LLM usage of one model and key source over a month; token counts add up only what's known. */
export interface LlmUsageSum {
  provider: string
  model: string
  /** platform (平台模型) or own_key (自有金鑰). */
  keySource: string
  inputTokens: number
  outputTokens: number
  /** Failed calls included. */
  calls: number
  /** Calls whose tokens the provider didn't report, left out of the sums. */
  callsWithUnknownUsage: number
}

export interface TranscriptionUsageSum {
  provider: string
  model: string
  audioSeconds: number
  calls: number
  callsWithUnknownUsage: number
}

/** Each user's monthly limits on what the platform pays for; own keys aren't limited. */
export interface UsageLimits {
  transcriptionMinutes: number
  /** Input plus output tokens on the platform model. */
  platformTokens: number
  /** Web searches (查網路) that went through; absent from gateways that predate it. */
  webSearches?: number
}

/** A user's usage over one month (YYYY-MM, Taiwan time), with the monthly limits. */
export interface MonthlyUsage {
  month: string
  llm: LlmUsageSum[]
  transcription: TranscriptionUsageSum[]
  /** Web searches this month; only the ones that went through count toward the limit. Absent from older gateways. */
  webSearches?: { succeeded: number; failed: number }
  limits: UsageLimits
}

/** One question of a 測驗 (quiz). */
export interface QuizQuestion {
  /** multiple_choice has 4 options; true_false's are always 「是」「否」. */
  kind: 'multiple_choice' | 'true_false'
  prompt: string
  options: string[]
  /** Position of the right option in `options`, from 0. */
  correctOption: number
  explanation: string
  /** Start times (seconds) of the segments the answer is based on; may be empty. */
  sourceTimestamps: number[]
}

/** A 測驗 (quiz) generated in the background from a job's transcript. */
export interface Quiz {
  id: string
  jobId: string
  questionCount: number
  /** A quiz stuck generating for over 5 minutes comes back FAILED. */
  status: 'GENERATING' | 'COMPLETED' | 'FAILED'
  /** Why it failed, for the user; null unless FAILED. */
  failureReason: string | null
  /** The transcript revision and model it was made from; 0 / null until it's done. */
  sourceRevision: number
  modelProvider: string | null
  model: string | null
  requestedAt: string
  completedAt: string | null
  /** Only when a single quiz is fetched; null in the list. */
  questions: QuizQuestion[] | null
  /** Most questions answered right in any attempt; null before the first attempt. */
  bestCorrectCount: number | null
}

/** The scored result of one attempt at a quiz; results follow the question order. */
export interface QuizAttemptResult {
  correctCount: number
  questionCount: number
  results: { chosenOption: number; correctOption: number; correct: boolean; explanation: string }[]
}

/** An action proposal (行動提案): a write the post-meeting agent wants to make, done only once the user confirms. */
export interface ActionProposal {
  id: string
  /** e.g. google_calendar */
  service: string
  /** The tool to call once confirmed, e.g. calendar_create_event. */
  tool: string
  /** Which form it needs, e.g. calendar_event (arguments: summary, start, end, description). */
  kind: string
  arguments: Record<string, unknown>
  /** PROPOSED: waiting for the user; DONE: carried out (resultUrl is what was made); FAILED: failureReason says why. */
  status: 'PROPOSED' | 'DONE' | 'FAILED'
  resultUrl: string | null
  failureReason: string | null
  /** Not carried out yet, and the same thing an earlier run of this job already created: shown as 上次已建立, unchecked. */
  previouslyCreated: boolean
}

/** A proposal the user checked, with the values they confirmed (maybe edited), to be carried out. */
export interface ConfirmedProposal {
  proposalId: string
  arguments: Record<string, unknown>
}

/** One run of 會後處理 (post-meeting processing) on a job. */
export interface PostMeetingRun {
  id: string
  /** LIMIT_REACHED: stopped at its tool-call or time limit, keeping the proposals so far. A run going for over 5
   * minutes comes back FAILED. */
  status: 'RUNNING' | 'COMPLETED' | 'LIMIT_REACHED' | 'FAILED'
  /** What it is doing while RUNNING, e.g. 「正在查詢你的行事曆…」. */
  progress: string | null
  failureReason: string | null
  modelProvider: string | null
  model: string | null
  requestedAt: string
  finishedAt: string | null
  proposals: ActionProposal[]
}

export interface PostMeeting {
  /** Whether this user can run it now; if not, unavailableReason says why (for the user). */
  available: boolean
  unavailableReason: string | null
  latestRun: PostMeetingRun | null
  /** Things it can't do yet, for the user (e.g. no Notion places chosen). */
  hints: string[]
  /** This job's runs before latestRun, newest first. */
  earlierRuns: PostMeetingRun[]
}

/** A Notion page. */
export interface NotionLocation {
  id: string
  title: string
  url: string | null
}

/** Where 會後處理 puts todos: the user's Google Tasks, or a checklist in each meeting's Notion page. */
export type TodoDestination = 'GOOGLE_TASKS' | 'NOTION'

/** Where each meeting's Notion page goes, as a sub-page (null when not chosen), and where todos go. */
export interface PostMeetingSettings {
  notionMeetingsPage: NotionLocation | null
  todoDestination: TodoDestination
}

/** Saving 會後處理's settings: an empty URL means not chosen. */
export interface PostMeetingSettingsUpdate {
  notionMeetingsPageUrl: string
  todoDestination: TodoDestination
}

/** A linked account (已連結的帳號): an outside service the user lets the platform use on their behalf. */
export interface Connection {
  service: 'google' | 'notion'
  /** INVALID: the access expired and couldn't be renewed, or was revoked on the service's side — link again. */
  status: 'CONNECTED' | 'INVALID' | 'NOT_CONNECTED'
  connectedAt: string | null
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
  /** Questions can also search the web (the deployment has a search service); absent from gateways that predate it. */
  webSearch?: boolean
}

/**
 * 講者數據的 AI 判斷 (.scratch/speaker-analytics): the questions each speaker asks and possible interruptions — estimates.
 * One per job; NONE until it's first analysed. `sourceRevision` is what the last finished analysis was based on, so it's
 * 過時 when the transcript's revision has moved on. `items` are the last finished results (kept while re-analysing).
 */
export interface SpeakerInsights {
  status: 'NONE' | 'GENERATING' | 'COMPLETED' | 'FAILED'
  failureReason: string | null
  sourceRevision: number
  modelProvider: string | null
  model: string | null
  requestedAt: string | null
  completedAt: string | null
  items: SpeakerInsight[]
}

export interface SpeakerInsight {
  kind: 'question' | 'interruption'
  speakerLabel: string
  /** Who was interrupted; null for a question. */
  interruptedLabel: string | null
  startTime: number
  /** The segment's own words. */
  text: string
}

/**
 * 決策紀錄: a job's extraction — GENERATING / COMPLETED / FAILED (failureReason for the user; the decisions found
 * earlier stay). sourceRevision / model: the last finished one's, 0 / null before that — 過時 when the transcript's
 * revision has moved on.
 */
export interface DecisionExtraction {
  status: 'GENERATING' | 'COMPLETED' | 'FAILED'
  failureReason: string | null
  sourceRevision: number
  modelProvider: string | null
  model: string | null
  requestedAt: string | null
  completedAt: string | null
}

/** A decision made in a meeting (決策): what, why, what else was considered, who proposed it, and where it was made. */
export interface Decision {
  id: string
  jobId: string
  statement: string
  /** Why, as said in the recording; empty when nobody said. */
  rationale: string
  /** Considered but not chosen. */
  alternatives: string[]
  /** The speaker's label; null when it isn't clear. */
  proposedBy: string | null
  /** That speaker's current name, for pages across jobs (no transcript there to look it up). */
  proposedByName: string | null
  /** 暫定: said to be confirmed later. */
  tentative: boolean
  /** Where it was made, and that segment's own words; a decision the user added may have neither. */
  startTime: number | null
  evidenceText: string | null
  source: 'ai' | 'user'
  edited: boolean
  /** 取代: what it changed from an earlier meeting (a deleted one doesn't count), and later decisions that changed it. */
  supersedes: DecisionLink | null
  supersededBy: DecisionLink[]
  /** The meeting's date (its job's upload time); null on older decisions. */
  meetingAt: string | null
  createdAt: string | null
}

/** Another decision (usually in another job), to link to. */
export interface DecisionLink {
  id: string
  jobId: string
  statement: string
  meetingAt: string | null
}

/** What the user writes for a decision (adding or editing); a time only when adding. */
export interface DecisionInput {
  statement: string
  rationale: string
  alternatives: string[]
  /** A speaker's label; null when it isn't clear. */
  proposedBy: string | null
  tentative: boolean
  startTime?: number | null
}

/** The job a decision on the 決策 page belongs to. */
export interface DecisionJob {
  jobId: string
  /** Null: no title, the file name is shown. */
  title: string | null
  fileName: string
  category: JobCategory | null
  createdAt: string | null
}

/**
 * The 決策 page: decisions across the user's jobs, each with its job — without a search, newest job first and by time
 * within one; with a search, best match first.
 */
export interface DecisionTimeline {
  items: { job: DecisionJob; decision: Decision }[]
}

/** A job's extraction (null when never extracted) and decisions, by time (those without one last). */
export interface JobDecisions {
  extraction: DecisionExtraction | null
  decisions: Decision[]
}

/**
 * 事實查核: a job's finding of claims — GENERATING / COMPLETED / FAILED (failureReason for the user; the claims found
 * earlier stay). sourceRevision / model: the last finished one's, 0 / null before that.
 */
export interface FactCheckExtraction {
  status: 'GENERATING' | 'COMPLETED' | 'FAILED'
  failureReason: string | null
  sourceRevision: number
  modelProvider: string | null
  model: string | null
  requestedAt: string | null
  completedAt: string | null
}

/** 查核's conclusion — never 正確／錯誤. not_checkable is decided when the claim is found (only the speaker knows). */
export type Verdict = 'supported' | 'disputed' | 'no_reliable_source' | 'not_checkable'

/** A web page a 查核 rests on; the order is the [n] the explanation cites. */
export interface ClaimSource {
  title: string
  url: string
  excerpt: string | null
}

/** 主張: something said in the recording that outside sources could check, and — once checked — what they say. */
export interface Claim {
  id: string
  jobId: string
  /** Who said it, where, and that segment's own words. */
  speakerLabel: string | null
  startTime: number
  text: string
  /** Put as one complete, searchable sentence: what a 查核 searches for. */
  claim: string
  kind: 'number' | 'fact'
  /** Null: not checked yet. */
  verdict: Verdict | null
  explanation: string | null
  sources: ClaimSource[]
  checkedAt: string | null
  checkModel: string | null
  /** Being checked right now. */
  checking: boolean
  /** Why the last check failed (the claim stays unchecked). */
  checkError: string | null
  /** The transcript revision it was found in: 過時 once the transcript has moved on. */
  sourceRevision: number
}

/** A job's finding of claims (null when never done) and the claims, by time. */
export interface JobFactCheck {
  extraction: FactCheckExtraction | null
  claims: Claim[]
}

/** The kinds of 多格式輸出 (new documents written from a job). */
export type OutputFormat = 'podcast_description' | 'youtube_description' | 'blog_post' | 'newsletter' | 'social_post'

/** The platform a social post (社群貼文) is written for. */
export type SocialPlatform = 'threads' | 'facebook' | 'instagram' | 'linkedin' | 'x'

/** What to make: a social post needs a platform; the instruction is the user's own request (up to 200 characters). */
export interface OutputRequest {
  format: OutputFormat
  platform?: SocialPlatform
  instruction?: string
}

/**
 * 多格式輸出 (see ai-service CONTEXT.md): a new document written from the job's summary and chapters, in Markdown. Made in
 * the background; a job can have many. `sourceRevision` is the transcript revision it was based on (過時 once that moves on).
 */
export interface GeneratedOutput {
  id: string
  jobId: string
  format: OutputFormat
  /** A social post's platform; null for the other kinds. */
  platform: SocialPlatform | null
  instruction: string | null
  status: 'GENERATING' | 'COMPLETED' | 'FAILED'
  failureReason: string | null
  content: string | null
  sourceRevision: number
  modelProvider: string | null
  model: string | null
  requestedAt: string
  completedAt: string | null
  editedAt: string | null
}

/** The languages a transcript can be translated into (譯文). */
export type TranslationLanguage = 'zh-TW' | 'en' | 'ja' | 'ko'

/**
 * 譯文 (see ai-service CONTEXT.md): a job's transcript in another language, one line per segment. One per language;
 * translated in batches in the background, so `translatedSegments` of `totalSegments` are ready while it's GENERATING.
 * A failed one keeps what was translated; asking again translates the rest.
 */
export interface TranslationSummary {
  language: TranslationLanguage
  status: 'GENERATING' | 'COMPLETED' | 'FAILED'
  failureReason: string | null
  totalSegments: number
  translatedSegments: number
  modelProvider: string | null
  model: string | null
  requestedAt: string
  completedAt: string | null
}

export interface TranslationDetail extends TranslationSummary {
  /** One per translated segment, by the transcript segment's id. sourceText is what it was translated from: when the
   *  segment's text has since been edited, the translation is out of date until ai-service re-translates it. */
  segments: { segmentId: string; text: string; sourceText: string }[]
}
