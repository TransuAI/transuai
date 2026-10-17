import { useCallback, useMemo, useState } from 'react'

// 自動跟隨（見 frontend CONTEXT.md）：只有兩種狀態，跟隨中 / 已暫停。使用者手動捲動、搜尋、編輯時
// pause；按「回到播放位置」或主動跳到某個時間點時 resume。
export interface AutoFollow {
  isFollowing: boolean
  pause: () => void
  resume: () => void
}

export function useAutoFollow(): AutoFollow {
  const [isFollowing, setIsFollowing] = useState(true)
  const pause = useCallback(() => setIsFollowing(false), [])
  const resume = useCallback(() => setIsFollowing(true), [])
  return useMemo(() => ({ isFollowing, pause, resume }), [isFollowing, pause, resume])
}
