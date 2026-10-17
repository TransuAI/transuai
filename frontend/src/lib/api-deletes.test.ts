import { afterEach, describe, expect, it, vi } from 'vitest'
import { decisionsApi, notesApi, translationsApi } from '@/lib/api'

// DELETEs answer 204 with no body: reading one as JSON throws in a real browser even though the delete went through,
// and every page test mocks the API so it wouldn't notice. Here only fetch is replaced.
describe('deleting answers 204 with no body', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['a translation', () => translationsApi.delete('job-1', 'ja')],
    ['a decision', () => decisionsApi.remove('job-1', 'd1')],
    ['a note', () => notesApi.remove('job-1', 'n1')],
  ])('%s resolves', async (_what, remove) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(remove()).resolves.toBeUndefined()
  })
})
