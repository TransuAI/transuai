import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronDown, Download, Loader2Icon, MessageCircleQuestion, Search, Sparkles } from 'lucide-react'
import { decisionsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { decisionHref } from '@/lib/decision-links'
import { downloadTextFile } from '@/lib/download'
import { toDecisionTimelineMarkdown, type ExportDecision } from '@/lib/export-formats'
import { CATEGORY_LABELS, jobDate, jobDisplayName } from '@/lib/job-display'
import { formatDuration } from '@/lib/media'
import { DecisionSupersession } from '@/components/decision-supersession'
import { MarkdownText } from '@/components/markdown-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ModelCredit } from '@/components/model-credit'
import type { Decision, DecisionJob, DecisionTimeline, JobCategory } from '@/types/api'

const SEARCH_DELAY_MS = 300

type Item = DecisionTimeline['items'][number]

function isCategory(value: string | null): value is JobCategory {
  return value !== null && Object.hasOwn(CATEGORY_LABELS, value)
}

// 決策 (see ai-service CONTEXT.md「決策」): every decision across the user's meetings — a timeline by meeting date
// (the job's upload time), newest first, which can be narrowed to a category or some jobs, or searched by words and
// meaning. Each decision opens its job where it was made. The search (q) and filters live in the address, as on the
// jobs page, so coming back from a job keeps them.
export function DecisionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q')?.trim() ?? ''
  const rawCategory = searchParams.get('category')
  const category = isCategory(rawCategory) ? rawCategory : null
  const jobIdsInAddress = searchParams.getAll('jobId').join(',')
  const jobIds = useMemo(() => (jobIdsInAddress ? jobIdsInAddress.split(',') : []), [jobIdsInAddress])

  const [items, setItems] = useState<Item[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // Every job seen so far, for the job filter: picking some narrows the results to them, and the rest must stay pickable.
  const [jobsSeen, setJobsSeen] = useState<Map<string, DecisionJob>>(new Map())

  // As the jobs page: what's typed follows into the address once typing pauses.
  const [draft, setDraft] = useState(query)
  const [lastQuery, setLastQuery] = useState(query)
  if (query !== lastQuery) {
    setLastQuery(query)
    if (draft.trim() !== query) setDraft(query)
  }
  const setParam = useCallback(
    (name: string, value: string | null, options?: { replace: boolean }) =>
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(name, value)
        else next.delete(name)
        return next
      }, options),
    [setSearchParams],
  )
  const chooseJobs = (chosen: string[]) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('jobId')
      for (const id of chosen) next.append('jobId', id)
      return next
    })
  // Typing replaces the address rather than adding to the history, so 上一頁 doesn't step back through half-typed words.
  useEffect(() => {
    const typed = draft.trim()
    if (typed === query) return
    const timer = setTimeout(() => setParam('q', typed || null, { replace: true }), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [draft, query, setParam])

  // Only the latest request's answer is shown: an older, slower one mustn't overwrite it.
  useEffect(() => {
    let current = true
    setIsLoading(true)
    decisionsApi
      .timeline({ ...(query && { q: query }), ...(category && { category }), ...(jobIds.length > 0 && { jobIds }) })
      .then((timeline) => {
        if (!current) return
        setItems(timeline.items)
        setJobsSeen((seen) => {
          const next = new Map(seen)
          for (const { job } of timeline.items) next.set(job.jobId, job)
          return next
        })
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (!current) return
        toast.error(err instanceof ApiError ? err.message : '無法載入決策')
        setIsLoading(false)
      })
    return () => {
      current = false
    }
  }, [query, category, jobIds])

  const meetings = useMemo(() => byMeeting(items), [items])
  const download = () => {
    const filters = [
      query && `搜尋：${query}`,
      category && `類型：${CATEGORY_LABELS[category]}`,
      jobIds.length > 0 &&
        `Job：${jobIds.map((id) => (jobsSeen.has(id) ? jobDisplayName(jobsSeen.get(id)!) : id)).join('、')}`,
    ].filter((filter): filter is string => Boolean(filter))
    downloadTextFile({
      fileName: '決策.md',
      content: toDecisionTimelineMarkdown({
        filters,
        meetings: meetings.map(({ job, decisions }) => ({
          heading: meetingHeading(job),
          decisions: decisions.map(exportDecision),
        })),
      }),
      mimeType: 'text/markdown',
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">決策</h1>
        <p className="text-sm text-muted-foreground">
          所有會議做成的決定，依會議日期排列；可以只看某個類型或某個檔案，也可以搜尋——意思相近、沒有那幾個字的也找得到。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="搜尋決策"
            placeholder="篩選下面的決策：關鍵字或意思相近的說法"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="pl-8"
          />
        </div>
        <select
          aria-label="類型"
          value={category ?? ''}
          onChange={(event) => setParam('category', event.target.value || null)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">全部類型</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 font-normal">
              {jobIds.length === 0 ? '檔案：全部' : `檔案：${jobIds.length} 個`}
              <ChevronDown className="size-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 max-w-72 overflow-y-auto">
            <DropdownMenuItem disabled={jobIds.length === 0} onSelect={() => chooseJobs([])}>
              全部檔案
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {[...jobsSeen.values()].map((job) => (
              <DropdownMenuCheckboxItem
                key={job.jobId}
                checked={jobIds.includes(job.jobId)}
                onCheckedChange={(checked) =>
                  chooseJobs(checked ? [...jobIds, job.jobId] : jobIds.filter((id) => id !== job.jobId))
                }
              >
                <span className="truncate">{jobDisplayName(job)}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" disabled={items.length === 0} onClick={download}>
          <Download className="size-4" />
          下載 Markdown
        </Button>
      </div>

      <AskDecisions category={category} jobIds={jobIds} />

      {isLoading && items.length === 0 ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query || category || jobIds.length > 0
            ? '沒有符合的決策'
            : '還沒有決策。會議與訪談轉錄完會自動抽出決策，其他檔案可以在工作區的「AI 工具 → 決策」抽出。'}
        </p>
      ) : query ? (
        <ul aria-label="搜尋結果" className="flex flex-col gap-3">
          {items.map(({ job, decision }) => (
            <DecisionCard key={decision.id} decision={decision} job={job} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-8">
          {meetings.map(({ job, decisions }) => (
            <section key={job.jobId} aria-labelledby={`meeting-${job.jobId}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2">
                {job.createdAt && <span className="text-sm text-muted-foreground tabular-nums">{jobDate(job.createdAt)}</span>}
                <h2 id={`meeting-${job.jobId}`} className="text-base font-medium">
                  <Link to={`/jobs/${job.jobId}`} className="hover:underline">
                    {jobDisplayName(job)}
                  </Link>
                </h2>
                {job.category && <Badge variant="outline">{CATEGORY_LABELS[job.category]}</Badge>}
              </div>
              <ul className="flex flex-col gap-3">
                {decisions.map((decision) => (
                  <DecisionCard key={decision.id} decision={decision} job={null} jobId={job.jobId} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

// 問決策: a question answered only from the user's decisions (within the page's filters) — the answer streams in, and the
// decisions it's based on are listed under it, numbered as the answer cites them [n].
function AskDecisions({ category, jobIds }: { category: JobCategory | null; jobIds: string[] }) {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<{
    question: string
    sources: Item[]
    answer: string
    model: string | null
    error: string | null
    done: boolean
  } | null>(null)
  const asking = asked !== null && !asked.done

  const ask = async (event: FormEvent) => {
    event.preventDefault()
    const text = question.trim()
    if (!text || asking) return
    setAsked({ question: text, sources: [], answer: '', model: null, error: null, done: false })
    const update = (change: (prev: NonNullable<typeof asked>) => NonNullable<typeof asked>) =>
      setAsked((prev) => (prev ? change(prev) : prev))
    try {
      await decisionsApi.ask(
        { question: text, ...(category && { category }), ...(jobIds.length > 0 && { jobIds }) },
        {
          onSources: (sources) => update((prev) => ({ ...prev, sources })),
          onDelta: (delta) => update((prev) => ({ ...prev, answer: prev.answer + delta })),
          onError: (message) => update((prev) => ({ ...prev, error: message })),
          onModel: (model) => update((prev) => ({ ...prev, model: model.model })),
        },
      )
    } catch (err) {
      update((prev) => ({ ...prev, error: err instanceof ApiError ? err.message : '無法回答，請稍後再試' }))
    }
    update((prev) => ({ ...prev, done: true }))
  }

  return (
    // Asking is its own card with a heading, so it doesn't read as a second search box: the search above filters the list,
    // this gets an answer written from the decisions.
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="size-4 text-primary" />
        問 AI：用決策紀錄回答你的問題
      </h2>
      <form onSubmit={(event) => void ask(event)} className="flex gap-2">
        <Input
          aria-label="問決策"
          placeholder="例如：當初為什麼選 PostgreSQL？"
          value={question}
          disabled={asking}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button type="submit" disabled={asking || !question.trim()}>
          {asking ? <Loader2Icon className="size-4 animate-spin" /> : <MessageCircleQuestion className="size-4" />}
          問
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">只根據你的決策紀錄回答（跟上面的篩選一樣的範圍）；紀錄裡沒有的會說沒有。</p>
      {asked && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">{asked.question}</p>
          {asked.answer && <MarkdownText text={asked.answer} className="leading-relaxed" />}
          {asking && !asked.answer && <p className="text-muted-foreground">找相關的決策…</p>}
          {asked.error && (
            <p role="alert" className="text-destructive">
              {asked.error}
            </p>
          )}
          {asked.sources.length > 0 && (
            <ol aria-label="回答依據的決策" className="flex flex-col gap-1 text-xs text-muted-foreground">
              {asked.sources.map(({ job, decision }, i) => (
                <li key={decision.id} className="flex flex-wrap gap-x-1.5">
                  <span>{`[${i + 1}]`}</span>
                  <span className="text-foreground/85">{decision.statement}</span>
                  <span>·</span>
                  {job.createdAt && <span>{jobDate(job.createdAt)}</span>}
                  <Link to={`/jobs/${job.jobId}`} className="hover:underline">
                    {jobDisplayName(job)}
                  </Link>
                  {decision.startTime !== null && (
                    <Link to={decisionHref(job.jobId, decision.id, decision.startTime)} className="font-mono hover:underline">
                      {formatDuration(decision.startTime)}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
          {asked.done && asked.model && <ModelCredit model={asked.model} verb="回答" />}
        </div>
      )}
    </div>
  )
}

// One decision; in search results it also names its meeting (job), since they aren't grouped by meeting there.
// The backend's default speaker name, until the user names the speaker.
const UNNAMED_SPEAKER = /^講者 \d+$/

function DecisionCard({ decision, job, jobId = job?.jobId }: { decision: Decision; job: DecisionJob | null; jobId?: string }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium leading-relaxed">{decision.statement}</p>
        <span className="flex shrink-0 items-center gap-1">
          {decision.supersededBy.length > 0 && <Badge variant="outline">已被取代</Badge>}
          {decision.tentative && <Badge variant="outline">暫定</Badge>}
          {decision.source === 'user' ? (
            <Badge variant="secondary">自己新增</Badge>
          ) : (
            decision.edited && <Badge variant="secondary">已修改</Badge>
          )}
        </span>
      </div>
      {job && (
        <p className="text-xs text-muted-foreground">
          {job.createdAt && `${jobDate(job.createdAt)} · `}
          <Link to={`/jobs/${job.jobId}`} className="hover:underline">
            {jobDisplayName(job)}
          </Link>
        </p>
      )}
      {decision.rationale && <p className="text-foreground/85">理由：{decision.rationale}</p>}
      {decision.alternatives.length > 0 && <p className="text-muted-foreground">沒選：{decision.alternatives.join('、')}</p>}
      {decision.proposedByName && (
        <p className="text-xs text-muted-foreground">
          提出：{decision.proposedByName}
          {/* 「講者 N」 says nothing across meetings: point to where it can be named (the name follows here once it is). */}
          {UNNAMED_SPEAKER.test(decision.proposedByName) && jobId && (
            <>
              {' · '}
              <Link to={decisionHref(jobId, decision.id, decision.startTime)} className="underline-offset-2 hover:underline">
                去命名
              </Link>
            </>
          )}
        </p>
      )}
      <DecisionSupersession decision={decision} />
      {decision.startTime !== null && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Link
            to={decisionHref(jobId!, decision.id, decision.startTime)}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {formatDuration(decision.startTime)}
          </Link>
          {decision.evidenceText && <span className="leading-relaxed">「{decision.evidenceText}」</span>}
        </p>
      )}
    </li>
  )
}

// Consecutive decisions of the same job form one meeting (the timeline comes ordered by meeting).
function byMeeting(items: Item[]): { job: DecisionJob; decisions: Decision[] }[] {
  const meetings: { job: DecisionJob; decisions: Decision[] }[] = []
  for (const { job, decision } of items) {
    const last = meetings.at(-1)
    if (last?.job.jobId === job.jobId) last.decisions.push(decision)
    else meetings.push({ job, decisions: [decision] })
  }
  return meetings
}

function meetingHeading(job: DecisionJob): string {
  return [job.createdAt && jobDate(job.createdAt), jobDisplayName(job)].filter(Boolean).join(' ')
}

// Across jobs who proposed it is the name stored with the decision (the transcript, with its speakers, isn't loaded here).
function exportDecision(decision: Decision): ExportDecision {
  return {
    statement: decision.statement,
    rationale: decision.rationale,
    alternatives: decision.alternatives,
    proposer: decision.proposedByName,
    tentative: decision.tentative,
    startTime: decision.startTime,
    evidenceText: decision.evidenceText,
  }
}
