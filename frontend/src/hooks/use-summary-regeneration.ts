import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { summaryApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import type { Summary } from '@/types/api'

const POLL_INTERVAL_MS = 3000

// 「重新產生摘要與章節」：在背景重新產生，期間舊內容照常顯示；每 3 秒問一次摘要，直到不再是 RUNNING——
// IDLE 就換上新摘要，FAILED 就提示並保留舊內容；兩種都通知 onSettled（成功時要重新載入章節，不論成敗都有新的
// 用量）。進頁面時已經是 RUNNING 的話也會接著等。
export function useSummaryRegeneration(
  jobId: string | undefined,
  summary: Summary | null,
  setSummary: (summary: Summary) => void,
  onSettled: (succeeded: boolean) => void,
) {
  const isRegenerating = summary?.regenerationStatus === 'RUNNING'
  // Between the click and the server's answer: one click is one request.
  const [isRequesting, setIsRequesting] = useState(false)

  useEffect(() => {
    if (!jobId || !isRegenerating) return
    const timer = setInterval(() => {
      summaryApi
        .get(jobId)
        .then((latest) => {
          if (latest.regenerationStatus === 'RUNNING') return
          setSummary(latest)
          const succeeded = latest.regenerationStatus !== 'FAILED'
          if (!succeeded) toast.error('重新產生失敗')
          onSettled(succeeded)
        })
        .catch(() => {}) // a missed poll just waits for the next one
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [jobId, isRegenerating, setSummary, onSettled])

  const regenerate = useCallback(() => {
    if (!jobId || isRequesting) return
    setIsRequesting(true)
    summaryApi
      .regenerate(jobId)
      .then(setSummary)
      .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法重新產生'))
      .finally(() => setIsRequesting(false))
  }, [jobId, isRequesting, setSummary])

  return { regenerate, isRegenerating, isRequesting }
}
