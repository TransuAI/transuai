import { useState, type ReactElement, type ReactNode } from 'react'
import { CalendarPlus, CheckCircle2, ClipboardList, ExternalLink, FileText, ListTodo, Loader2Icon, Mail, RotateCcw } from 'lucide-react'
import { fromLocalInput, toLocalInput } from '@/lib/local-time'
import { formatShortDateTime } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ActionProposal, ConfirmedProposal, PostMeeting, PostMeetingRun } from '@/types/api'

function clockTime(isoTimestamp: string) {
  const date = new Date(isoTimestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

type Draft = Record<string, unknown>
type SetField = (name: string, value: unknown) => void

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

const textareaClass = 'rounded-md border bg-background px-3 py-2 text-sm'

function CalendarEventFields({ id, draft, set }: { id: string; draft: Draft; set: SetField }) {
  return (
    <>
      <Field id={`${id}-summary`} label="標題">
        <Input id={`${id}-summary`} value={text(draft.summary)} onChange={(e) => set('summary', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field id={`${id}-start`} label="開始">
          <Input
            id={`${id}-start`}
            type="datetime-local"
            value={toLocalInput(text(draft.start))}
            onChange={(e) => set('start', fromLocalInput(e.target.value))}
          />
        </Field>
        <Field id={`${id}-end`} label="結束">
          <Input
            id={`${id}-end`}
            type="datetime-local"
            value={toLocalInput(text(draft.end))}
            onChange={(e) => set('end', fromLocalInput(e.target.value))}
          />
        </Field>
      </div>
      <Field id={`${id}-description`} label="描述">
        <textarea
          id={`${id}-description`}
          value={text(draft.description)}
          onChange={(e) => set('description', e.target.value)}
          rows={2}
          className={textareaClass}
        />
      </Field>
    </>
  )
}

// Recipients are typed as free text ("a@x.com, b@y.com"); it's kept as typed and only split when the proposal is sent.
const RECIPIENTS_TEXT = 'recipientsText'
const recipientsText = (draft: Draft) =>
  typeof draft[RECIPIENTS_TEXT] === 'string' ? (draft[RECIPIENTS_TEXT] as string) : (Array.isArray(draft.to) ? draft.to.join(', ') : '')
const recipients = (draft: Draft) => recipientsText(draft).split(/[,，;；\s]+/).filter(Boolean)
// A plain address, as ai-service accepts it: no display names, quotes, brackets or commas.
const EMAIL = /^[^@\s,;:<>()[\]"]+@[^@\s,;:<>()[\]"]+\.[^@\s,;:<>()[\]"]+$/

function EmailDraftFields({ id, draft, set }: { id: string; draft: Draft; set: SetField }) {
  return (
    <>
      <Field id={`${id}-to`} label="收件人">
        <Input
          id={`${id}-to`}
          placeholder="用逗號分隔多個地址，可以留空"
          value={recipientsText(draft)}
          onChange={(e) => set(RECIPIENTS_TEXT, e.target.value)}
        />
      </Field>
      <Field id={`${id}-subject`} label="主旨">
        <Input id={`${id}-subject`} value={text(draft.subject)} onChange={(e) => set('subject', e.target.value)} />
      </Field>
      <Field id={`${id}-body`} label="內文">
        <textarea
          id={`${id}-body`}
          value={text(draft.body)}
          onChange={(e) => set('body', e.target.value)}
          rows={5}
          className={textareaClass}
        />
      </Field>
    </>
  )
}

function NotionPageFields({ id, draft, set }: { id: string; draft: Draft; set: SetField }) {
  return (
    <>
      <Field id={`${id}-title`} label="標題">
        <Input id={`${id}-title`} value={text(draft.title)} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field id={`${id}-content`} label="內容">
        <textarea
          id={`${id}-content`}
          value={text(draft.content)}
          onChange={(e) => set('content', e.target.value)}
          rows={6}
          className={textareaClass}
        />
      </Field>
    </>
  )
}

const propertiesOf = (draft: Draft) =>
  draft.properties && typeof draft.properties === 'object' ? (draft.properties as Record<string, unknown>) : {}

// A row for the user's todo database: one field per property the agent filled in, named as in the database, and the
// row's body (the source timestamp, notes).
function NotionDatabaseItemFields({ id, draft, set }: { id: string; draft: Draft; set: SetField }) {
  const properties = propertiesOf(draft)
  return (
    <>
      {Object.entries(properties).map(([name, value], i) => (
        <Field key={name} id={`${id}-property-${i}`} label={name}>
          <Input
            id={`${id}-property-${i}`}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => set('properties', { ...properties, [name]: e.target.value })}
          />
        </Field>
      ))}
      <Field id={`${id}-body`} label="內文">
        <textarea
          id={`${id}-body`}
          value={text(draft.content)}
          onChange={(e) => set('content', e.target.value)}
          rows={3}
          className={textareaClass}
        />
      </Field>
    </>
  )
}

function GoogleTaskFields({ id, draft, set }: { id: string; draft: Draft; set: SetField }) {
  return (
    <>
      <Field id={`${id}-title`} label="標題">
        <Input id={`${id}-title`} value={text(draft.title)} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field id={`${id}-assignee`} label="負責人">
          <Input id={`${id}-assignee`} value={text(draft.assignee)} onChange={(e) => set('assignee', e.target.value)} />
        </Field>
        <Field id={`${id}-due`} label="期限">
          <Input id={`${id}-due`} type="date" value={text(draft.due)} onChange={(e) => set('due', e.target.value)} />
        </Field>
        <Field id={`${id}-timestamp`} label="依據的錄音時間">
          <Input
            id={`${id}-timestamp`}
            placeholder="例如 12:34"
            value={text(draft.timestamp)}
            onChange={(e) => set('timestamp', e.target.value)}
          />
        </Field>
      </div>
      <Field id={`${id}-notes`} label="內容">
        <textarea
          id={`${id}-notes`}
          value={text(draft.notes)}
          onChange={(e) => set('notes', e.target.value)}
          rows={2}
          className={textareaClass}
        />
      </Field>
    </>
  )
}

interface ProposalKind {
  label: string
  icon: typeof CalendarPlus
  title: (args: Draft) => string
  Fields: (props: { id: string; draft: Draft; set: SetField }) => ReactElement
  // What's wrong with the values in the form, before anything is sent; null when they're fine.
  problem: (draft: Draft) => string | null
  // The arguments to send, from the form.
  confirmed: (draft: Draft) => Draft
  when?: (args: Draft) => string | null
  linkText: string
}

const KINDS: Record<string, ProposalKind> = {
  calendar_event: {
    label: '行事曆活動',
    icon: CalendarPlus,
    title: (args) => text(args.summary),
    Fields: CalendarEventFields,
    problem: (draft) => {
      if (!text(draft.summary).trim()) return '請填標題'
      const start = new Date(text(draft.start)).getTime()
      const end = new Date(text(draft.end)).getTime()
      if (Number.isNaN(start) || Number.isNaN(end)) return '請填開始與結束時間'
      if (end <= start) return '結束時間要晚於開始時間'
      return null
    },
    confirmed: (draft) => draft,
    when: (args) =>
      text(args.start) && text(args.end) ? `${formatShortDateTime(text(args.start))}–${clockTime(text(args.end))}` : null,
    linkText: '在 Google 日曆開啟',
  },
  email_draft: {
    label: 'email 草稿',
    icon: Mail,
    title: (args) => text(args.subject),
    Fields: EmailDraftFields,
    problem: (draft) => {
      const invalid = recipients(draft).filter((address) => !EMAIL.test(address))
      if (invalid.length) return `這些不是 email 地址：${invalid.join('、')}`
      if (!text(draft.subject).trim() || !text(draft.body).trim()) return '請填主旨與內文'
      return null
    },
    confirmed: (draft) => {
      const { [RECIPIENTS_TEXT]: _typed, ...args } = draft
      return { ...args, to: recipients(draft) }
    },
    linkText: '在 Gmail 開啟',
  },
  google_task: {
    label: 'Google Tasks 待辦',
    icon: ListTodo,
    title: (args) => text(args.title),
    Fields: GoogleTaskFields,
    problem: (draft) => (!text(draft.title).trim() ? '請填標題' : null),
    confirmed: (draft) => draft,
    when: (args) => (text(args.due) ? `期限 ${text(args.due)}` : null),
    linkText: '在 Google Tasks 開啟',
  },
  notion_page: {
    label: 'Notion 頁面',
    icon: FileText,
    title: (args) => text(args.title),
    Fields: NotionPageFields,
    problem: (draft) => (!text(draft.title).trim() || !text(draft.content).trim() ? '請填標題與內容' : null),
    confirmed: (draft) => draft,
    linkText: '在 Notion 開啟',
  },
  notion_database_item: {
    label: 'Notion 待辦',
    icon: ListTodo,
    // The first property the agent filled in is usually the todo's title.
    title: (args) => String(Object.values(propertiesOf(args))[0] ?? ''),
    Fields: NotionDatabaseItemFields,
    problem: (draft) => (Object.keys(propertiesOf(draft)).length === 0 ? '沒有任何欄位' : null),
    confirmed: (draft) => draft,
    linkText: '在 Notion 開啟',
  },
}

// A proposal this card can edit, not carried out yet: waiting, or failed and fixable.
const isEditable = (proposal: ActionProposal) => Object.hasOwn(KINDS, proposal.kind) && proposal.status !== 'DONE'

// A proposal (行動提案) not carried out yet: a form to check and edit first. A failed one also says why and can be
// tried again on its own.
function ProposalForm({
  proposal,
  draft,
  checked,
  onChange,
  onCheck,
  onRetry,
  isExecuting,
}: {
  proposal: ActionProposal
  draft: Draft
  checked: boolean
  onChange: (draft: Draft) => void
  onCheck: (checked: boolean) => void
  onRetry: () => void
  isExecuting: boolean
}) {
  const kind = KINDS[proposal.kind]
  const problem = kind.problem(draft)
  const Icon = kind.icon
  return (
    <li
      role="group"
      aria-label={`${kind.label}：${kind.title(proposal.arguments)}`}
      className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label="執行這一項" />
        <Icon className="size-3.5" />
        {kind.label}
      </label>
      <kind.Fields id={`proposal-${proposal.id}`} draft={draft} set={(name, value) => onChange({ ...draft, [name]: value })} />
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      {proposal.status === 'FAILED' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-destructive">{proposal.failureReason ?? '執行失敗'}</p>
          <Button size="sm" variant="outline" className="w-fit" disabled={isExecuting || !!problem} onClick={onRetry}>
            <RotateCcw className="size-3.5" />
            重試
          </Button>
        </div>
      )}
    </li>
  )
}

// A proposal carried out (with a link to what was made), or one of a kind this card can't edit yet.
function ProposalResult({ proposal }: { proposal: ActionProposal }) {
  const kind = Object.hasOwn(KINDS, proposal.kind) ? KINDS[proposal.kind] : undefined
  const Icon = kind?.icon
  const when = kind?.when?.(proposal.arguments)
  return (
    <li className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
      {kind && Icon && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" />
          {kind.label}
        </span>
      )}
      <span className="font-medium">{kind ? kind.title(proposal.arguments) : proposal.kind}</span>
      {when && <span className="text-xs text-muted-foreground">{when}</span>}
      {proposal.status === 'DONE' && (
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <CheckCircle2 className="size-3.5 text-green-600" aria-hidden />
          已建立
          {proposal.resultUrl && (
            <a href={proposal.resultUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
              {kind?.linkText ?? '開啟'}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </span>
      )}
      {proposal.status === 'FAILED' && <p className="text-xs text-destructive">{proposal.failureReason ?? '執行失敗'}</p>}
    </li>
  )
}

// The proposals of one finished run. Keyed by the run, so another run's edits never carry over.
function ProposalList({
  run,
  onExecute,
  onRetry,
  isExecuting,
}: {
  run: PostMeetingRun
  onExecute: (proposals: ConfirmedProposal[]) => void
  onRetry: (proposalId: string) => void
  isExecuting: boolean
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  // Waiting proposals start checked; failed ones start unchecked (each has its own 重試).
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(run.proposals.filter((p) => p.status === 'PROPOSED').map((p) => p.id)),
  )
  const draftOf = (proposal: ActionProposal) => drafts[proposal.id] ?? proposal.arguments
  const editable = run.proposals.filter(isEditable)
  const chosen = editable.filter((p) => checked.has(p.id))
  const confirm = (proposal: ActionProposal): ConfirmedProposal => ({
    proposalId: proposal.id,
    arguments: KINDS[proposal.kind].confirmed(draftOf(proposal)),
  })

  if (run.proposals.length === 0) {
    return <p className="text-sm text-muted-foreground">這場會議沒有需要處理的事項</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {run.proposals.map((proposal) =>
          isEditable(proposal) ? (
            <ProposalForm
              key={proposal.id}
              proposal={proposal}
              draft={draftOf(proposal)}
              checked={checked.has(proposal.id)}
              onChange={(draft) => setDrafts((prev) => ({ ...prev, [proposal.id]: draft }))}
              onCheck={(isChecked) =>
                setChecked((prev) => {
                  const next = new Set(prev)
                  if (isChecked) next.add(proposal.id)
                  else next.delete(proposal.id)
                  return next
                })
              }
              // Unchanged: the same values again; edited: carry out just this one with the new values.
              onRetry={() => (drafts[proposal.id] ? onExecute([confirm(proposal)]) : onRetry(proposal.id))}
              isExecuting={isExecuting}
            />
          ) : (
            <ProposalResult key={proposal.id} proposal={proposal} />
          ),
        )}
      </ul>
      {editable.length > 0 && (
        <Button
          size="sm"
          className="w-fit"
          disabled={chosen.length === 0 || chosen.some((p) => KINDS[p.kind].problem(draftOf(p))) || isExecuting}
          onClick={() => onExecute(chosen.map(confirm))}
        >
          {isExecuting && <Loader2Icon className="size-3.5 animate-spin" />}
          執行勾選的項目
        </Button>
      )}
    </div>
  )
}

interface PostMeetingSectionProps {
  postMeeting: PostMeeting | null
  onStart: () => void
  /** A start request is on its way; one click is one request. */
  isStarting: boolean
  onExecute: (runId: string, proposals: ConfirmedProposal[]) => void
  onRetry: (runId: string, proposalId: string) => void
  isExecuting: boolean
}

// 會後處理 (see ai-service CONTEXT.md): the Studio card that starts the agent on this job and shows what it proposes
// (行動提案). The agent only reads; each proposal is checked and edited by the user, and only carried out once they
// confirm (ai-service ADR 0007).
export function PostMeetingSection({ postMeeting, onStart, isStarting, onExecute, onRetry, isExecuting }: PostMeetingSectionProps) {
  const run = postMeeting?.latestRun ?? null
  const isRunning = run?.status === 'RUNNING'
  return (
    <section aria-labelledby="post-meeting-heading" className="flex flex-col gap-2">
      <h3 id="post-meeting-heading" className="flex items-center gap-2 text-sm font-medium">
        <ClipboardList className="size-4" />
        會後處理
      </h3>
      <p className="text-xs text-muted-foreground">
        讀這場會議、查你的行事曆，把會後該做的事（排下次會議、會議紀錄的 email 草稿）整理成提案；任何改動都要你確認後才會執行。
      </p>
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={!postMeeting?.available || isRunning || isStarting}
        onClick={onStart}
      >
        開始會後處理
      </Button>
      {postMeeting && !postMeeting.available && postMeeting.unavailableReason && (
        <p className="text-xs text-muted-foreground">{postMeeting.unavailableReason}</p>
      )}
      {postMeeting?.hints.map((hint) => (
        <p key={hint} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ))}
      {isRunning && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2Icon className="size-3.5 animate-spin" />
          {run.progress ?? '執行中…'}
        </p>
      )}
      {run?.status === 'FAILED' && <p className="text-xs text-destructive">{run.failureReason ?? '會後處理失敗'}</p>}
      {(run?.status === 'COMPLETED' || run?.status === 'LIMIT_REACHED') && (
        <>
          {run.status === 'LIMIT_REACHED' && (
            <p className="text-xs text-muted-foreground">已達上限（工具呼叫次數或時間），以下是已經整理好的提案。</p>
          )}
          <ProposalList
            key={run.id}
            run={run}
            onExecute={(proposals) => onExecute(run.id, proposals)}
            onRetry={(proposalId) => onRetry(run.id, proposalId)}
            isExecuting={isExecuting}
          />
        </>
      )}
    </section>
  )
}
