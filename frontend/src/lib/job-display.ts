import type { Job, JobCategory } from '@/types/api'

// 標題與類型（見 upload-service CONTEXT.md）：有標題就顯示標題，否則顯示上傳時的檔名。規則只在這裡決定。
export function jobDisplayName(job: Pick<Job, 'title' | 'fileName'>): string {
  return job.title || job.fileName
}

export const CATEGORY_LABELS: Record<JobCategory, string> = {
  meeting: '會議',
  lecture: '課程',
  interview: '訪談',
  podcast: 'Podcast／節目',
  video: '影片',
  other: '其他',
}
