import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Trash2, Upload } from 'lucide-react'
import { jobsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { formatBytes, formatDuration } from '@/lib/media'
import { JobStatusBadge } from '@/components/job-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import type { Job } from '@/types/api'

const PAGE_SIZE = 10

export function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null)

  const loadJobs = useCallback(async (targetPage: number) => {
    setIsLoading(true)
    try {
      const res = await jobsApi.list({ page: targetPage, pageSize: PAGE_SIZE })
      setJobs(res.jobs)
      setTotalCount(res.totalCount)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '無法載入 Job 列表')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadJobs(page)
  }, [page, loadJobs])

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await jobsApi.remove(deleteTarget.jobId)
      toast.success('已刪除')
      setDeleteTarget(null)
      void loadJobs(page)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '刪除失敗')
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">我的 Job</h1>
        <Button asChild size="sm">
          <Link to="/upload">
            <Upload className="size-4" />
            上傳新檔案
          </Link>
        </Button>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {!isLoading && jobs.length === 0 && (
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
                <p className="truncate font-medium">{job.fileName}</p>
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
          <Button
            variant="outline"
            size="icon"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
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
