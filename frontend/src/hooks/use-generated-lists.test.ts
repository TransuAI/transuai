import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { outputsApi, quizApi } from '@/lib/api'
import type { GeneratedOutput, Quiz } from '@/types/api'
import { useOutputs } from './use-outputs'
import { useQuizzes } from './use-quizzes'

vi.mock('@/lib/api', () => ({
  outputsApi: { list: vi.fn(), request: vi.fn(), update: vi.fn() },
  quizApi: { list: vi.fn(), request: vi.fn() },
}))

afterEach(() => {
  vi.clearAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const output = { id: 'out-1', status: 'GENERATING' } as GeneratedOutput
const quiz = { id: 'quiz-1', status: 'GENERATING' } as Quiz

// The server makes the new item as soon as it's asked for. A list that answers before the request's own answer comes back
// already has it; adding the request's answer on top of that showed it twice (React: two children with the same key).
describe('a new output or quiz shows once when the list answers first', () => {
  it('outputs', async () => {
    const listed = deferred<GeneratedOutput[]>()
    const requested = deferred<GeneratedOutput>()
    vi.mocked(outputsApi.list).mockReturnValue(listed.promise)
    vi.mocked(outputsApi.request).mockReturnValue(requested.promise)
    const { result } = renderHook(() => useOutputs('job-1', true, () => {}))

    act(() => result.current.request({ format: 'podcast_description' } as never))
    await act(async () => listed.resolve([output]))
    await act(async () => requested.resolve(output))

    expect(result.current.outputs.map((o) => o.id)).toEqual(['out-1'])
  })

  it('quizzes', async () => {
    const listed = deferred<Quiz[]>()
    const requested = deferred<Quiz>()
    vi.mocked(quizApi.list).mockReturnValue(listed.promise)
    vi.mocked(quizApi.request).mockReturnValue(requested.promise)
    const { result } = renderHook(() => useQuizzes('job-1', true, () => {}))

    act(() => result.current.requestQuiz(5))
    await act(async () => listed.resolve([quiz]))
    await act(async () => requested.resolve(quiz))

    expect(result.current.quizzes.map((q) => q.id)).toEqual(['quiz-1'])
  })
})
