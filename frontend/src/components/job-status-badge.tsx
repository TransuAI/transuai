import { Badge } from '@/components/ui/badge'
import type { JobStatus } from '@/types/api'

const STATUS_LABEL: Record<JobStatus, string> = {
  PENDING: '等待中',
  UPLOADING: '上傳中',
  UPLOADED: '已上傳',
  TRANSCRIBING: '轉錄中',
  TRANSCRIBED: '已轉錄',
  SUMMARIZING: '摘要中',
  COMPLETED: '已完成',
  FAILED: '失敗',
}

const STATUS_VARIANT: Record<JobStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  UPLOADING: 'secondary',
  UPLOADED: 'secondary',
  TRANSCRIBING: 'secondary',
  TRANSCRIBED: 'secondary',
  SUMMARIZING: 'secondary',
  COMPLETED: 'default',
  FAILED: 'destructive',
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
}

export function isJobInProgress(status: JobStatus): boolean {
  return status !== 'COMPLETED' && status !== 'FAILED'
}
