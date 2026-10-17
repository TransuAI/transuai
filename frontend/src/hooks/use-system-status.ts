import { useEffect, useState } from 'react'
import { systemApi } from '@/lib/api'
import type { SystemStatus } from '@/types/api'

// Asked once per page load and shared: whether this is a fresh install (no account yet) and whether mail is set up.
let pending: Promise<SystemStatus> | null = null

function load(): Promise<SystemStatus> {
  pending ??= systemApi.status().catch((err: unknown) => {
    pending = null // a failure isn't remembered: the next page asks again
    throw err
  })
  return pending
}

/** null until known (and when it couldn't be read): callers show nothing that depends on it meanwhile. */
export function useSystemStatus(): SystemStatus | null {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  useEffect(() => {
    let current = true
    load().then(
      (loaded) => current && setStatus(loaded),
      () => {},
    )
    return () => {
      current = false
    }
  }, [])
  return status
}

/** Tests start from a fresh page load. */
export function forgetSystemStatus() {
  pending = null
}
