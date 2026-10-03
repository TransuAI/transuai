import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLOSE_JOB_NOT_FOUND,
  CLOSE_TOO_MANY_CONNECTIONS,
  CLOSE_UNAUTHORIZED,
  RECONNECT_DELAY_MS,
  TOO_MANY_CONNECTIONS_DELAY_MS,
  useJobSocket,
} from '@/hooks/use-job-socket'
import { renewAccessToken } from '@/lib/api-client'
import { clearSession, saveSession, updateTokens } from '@/lib/auth-storage'

vi.mock('@/lib/api-client', () => ({ renewAccessToken: vi.fn() }))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((msg: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {}

  open() {
    this.onopen?.()
  }

  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  closedByServer(code: number) {
    this.onclose?.({ code })
  }
}

const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]

describe('useJobSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    saveSession({ accessToken: 'access-1', refreshToken: 'refresh-1', user: { id: 'u1', email: 'a@b.c' } as never })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.mocked(renewAccessToken).mockReset()
    clearSession()
  })

  it('sends the access token as the first message', () => {
    renderHook(() => useJobSocket('job-1', vi.fn()))

    latest().open()

    expect(latest().url).toMatch(/\/ws\/jobs\/job-1$/)
    expect(latest().url).not.toContain('access-1')
    expect(JSON.parse(latest().sent[0])).toEqual({ type: 'auth', accessToken: 'access-1' })
  })

  it('passes status events on, but not the subscribed acknowledgement', () => {
    const onEvent = vi.fn()
    renderHook(() => useJobSocket('job-1', onEvent))

    latest().receive({ type: 'subscribed', jobId: 'job-1' })
    latest().receive({ jobId: 'job-1', status: 'COMPLETED', progress: 100 })

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ jobId: 'job-1', status: 'COMPLETED', progress: 100 })
  })

  it('does not connect without a session', () => {
    clearSession()
    renderHook(() => useJobSocket('job-1', vi.fn()))

    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('reconnects after an ordinary disconnect', () => {
    renderHook(() => useJobSocket('job-1', vi.fn()))

    latest().closedByServer(1006)
    act(() => vi.advanceTimersByTime(RECONNECT_DELAY_MS))

    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('does not reconnect to a job that is not the user’s', () => {
    renderHook(() => useJobSocket('job-1', vi.fn()))

    latest().closedByServer(CLOSE_JOB_NOT_FOUND)
    act(() => vi.advanceTimersByTime(TOO_MANY_CONNECTIONS_DELAY_MS * 2))

    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('waits longer when there are too many connections', () => {
    renderHook(() => useJobSocket('job-1', vi.fn()))

    latest().closedByServer(CLOSE_TOO_MANY_CONNECTIONS)
    act(() => vi.advanceTimersByTime(RECONNECT_DELAY_MS))
    expect(FakeWebSocket.instances).toHaveLength(1)

    act(() => vi.advanceTimersByTime(TOO_MANY_CONNECTIONS_DELAY_MS))
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('renews the access token and reconnects with the new one when the token is refused', async () => {
    vi.mocked(renewAccessToken).mockImplementation(async () => {
      updateTokens('access-2', 'refresh-2')
      return 'access-2'
    })
    renderHook(() => useJobSocket('job-1', vi.fn()))

    latest().closedByServer(CLOSE_UNAUTHORIZED)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(renewAccessToken).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
    latest().open()
    expect(JSON.parse(latest().sent[0])).toEqual({ type: 'auth', accessToken: 'access-2' })
  })

  it('gives up when the renewed token is refused too', async () => {
    vi.mocked(renewAccessToken).mockResolvedValue('access-2')
    renderHook(() => useJobSocket('job-1', vi.fn()))

    latest().closedByServer(CLOSE_UNAUTHORIZED)
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    latest().closedByServer(CLOSE_UNAUTHORIZED)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(renewAccessToken).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('does not reconnect when the session cannot be renewed', async () => {
    vi.mocked(renewAccessToken).mockResolvedValue(null)
    renderHook(() => useJobSocket('job-1', vi.fn()))

    latest().closedByServer(CLOSE_UNAUTHORIZED)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
