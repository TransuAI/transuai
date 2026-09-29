import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search, Trash2, Upload } from 'lucide-react'
import { jobsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { CATEGORY_LABELS, jobDisplayName } from '@/lib/job-display'
import { formatBytes, formatDuration } from '@/lib/media'
import { JobStatusBadge } from '@/components/job-status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Job, JobCategory } from '@/types/api'

const PAGE_SIZE = 10
const SEARCH_DELAY_MS = 300

function isCategory(value: string | null): value is JobCategory {
  return value !== null && Object.hasOwn(CATEGORY_LABELS, value)
}

// The search (q), category filter and page live in the address, so a reload or coming back from a job keeps them.
export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q')?.trim() ?? ''
  const rawCategory = searchParams.get('category')
  const category = isCategory(rawCategory) ? rawCategory : null
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '', 10) || 1)
  const filtered = query !== '' || category !== null

  const [jobs, setJobs] = useState<Job[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [reloads, setReloads] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null)

  // What's typed in the search box; the address (and so the search) follows once typing pauses. When the address
  // changes some other way (back, 清除), the box follows it — unless it already says the same, give or take spaces
  // the user is still typing.
  const [draft, setDraft] = useState(query)
  const [lastQuery, setLastQuery] = useState(query)
  if (query !== lastQuery) {
    setLastQuery(query)
    if (draft.trim() !== query) setDraft(query)
  }

  // A new search or filter starts again from the first page. Typing replaces the address rather than adding to the
  // history, so 上一頁 doesn't step back through half-typed words.
  useEffect(() => {
    const typed = draft.trim()
    if (typed === query) return
    const timer = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (typed) next.set('q', typed)
          else next.delete('q')
          next.delete('page')
          return next
        },
        { replace: true },
      )
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [draft, query, setSearchParams])

  const chooseCategory = (chosen: JobCategory | null) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (chosen) next.set('category', chosen)
      else next.delete('category')
      next.delete('page')
      return next
    })
  const goToPage = (target: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (target > 1) next.set('page', String(target))
      else next.delete('page')
      return next
    })

  // Only the latest request's answer is shown: an older, slower one mustn't overwrite it.
  useEffect(() => {
    let current = true
    setIsLoading(true)
    jobsApi
      .list({ page, pageSize: PAGE_SIZE, ...(query && { query }), ...(category && { category }) })
      .then((res) => {
        if (!current) return
        // Past the last page (its only job was just deleted, or an old address): go to the last page instead.
        const lastPage = Math.max(1, Math.ceil(res.totalCount / PAGE_SIZE))
        if (res.jobs.length === 0 && page > lastPage) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev)
              if (lastPage > 1) next.set('page', String(lastPage))
              else next.delete('page')
              return next
            },
            { replace: true },
          )
          return // still loading: the list for that page comes next
        }
        setJobs(res.jobs)
        setTotalCount(res.totalCount)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (!current) return
        toast.error(err instanceof ApiError ? err.message : '無法載入 Job 列表')
        setIsLoading(false)
      })
    return () => {
      current = false
    }
  }, [page, query, category, reloads, setSearchParams])

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await jobsApi.remove(deleteTarget.jobId)
      toast.success('已刪除')
      setDeleteTarget(null)
      setReloads((n) => n + 1)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '刪除失敗')
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">我的 Job</h1>
        <Button asChild size="sm">
          <Link to="/upload">
            <Upload className="size-4" />
            上傳新檔案
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="搜尋標題或檔名"
            placeholder="搜尋標題或檔名"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="pl-8"
          />
        </div>
        <select
          aria-label="類型"
          value={category ?? ''}
          onChange={(event) => chooseCategory(isCategory(event.target.value) ? event.target.value : null)}
          className="h-9 rounded-md border bg-background px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-40"
        >
          <option value="">全部類型</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {!isLoading && jobs.length === 0 && filtered && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
            <p>找不到符合的 Job</p>
            <Button size="sm" variant="outline" onClick={() => setSearchParams(new URLSearchParams())}>
              清除搜尋與篩選
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && jobs.length === 0 && !filtered && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
            <p>還沒有任何 Job</p>
            <Button asChild size="sm">
              <Link to="/upload">上傳第一個檔案</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading &&
        jobs.map((job) => (
          <Card key={job.jobId}>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <Link to={`/jobs/${job.jobId}`} className="flex-1 min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate font-medium">{jobDisplayName(job)}</p>
                  {job.category && (
                    <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                      {CATEGORY_LABELS[job.category]}
                    </Badge>
                  )}
                </div>
                {/* The file name stays in view, to match it with the file on the user's computer. */}
                {job.title && <p className="truncate text-xs text-muted-foreground">{job.fileName}</p>}
                <p className="text-sm text-muted-foreground">
                  {formatBytes(job.fileSizeBytes)} · {formatDuration(job.durationSeconds)} ·{' '}
                  {new Date(job.createdAt).toLocaleString()}
                </p>
                {job.status === 'FAILED' && job.errorReason && (
                  <p className="mt-1 text-sm text-destructive">{job.errorReason}</p>
                )}
              </Link>
              <div className="flex items-center gap-3">
                <JobStatusBadge status={job.status} />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleteTarget(job)}
                  aria-label="刪除"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

      {!isLoading && totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="icon" aria-label="上一頁" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="下一頁"
            disabled={page >= totalPages}
            onClick={() => goToPage(page + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除這個 Job?</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.fileName}」與其逐字稿、摘要都會被永久刪除,無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>刪除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
