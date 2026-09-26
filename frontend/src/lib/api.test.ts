import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '@/lib/api-client'
import { transcriptApi } from '@/lib/api'

vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn(), apiFetchVoid: vi.fn(), requestSse: vi.fn() }))

afterEach(() => vi.clearAllMocks())

describe('transcriptApi.get', () => {
  it('treats a transcript without a speaker list (a backend from before speakers) as having no speakers', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      jobId: 'job-1',
      language: 'Chinese',
      fullText: '第一句',
      revision: 0,
      segments: [{ id: 'seg-1', startTime: 0, endTime: 1, speakerLabel: null, text: '第一句', originalText: '第一句' }],
    })

    const transcript = await transcriptApi.get('job-1')

    expect(transcript.speakers).toEqual([])
  })

  it('keeps the speakers the backend sends', async () => {
    const speakers = [{ label: 'S1', displayName: '主持人', displayOrder: 1 }]
    vi.mocked(apiFetch).mockResolvedValue({ jobId: 'job-1', language: 'zh-TW', fullText: '', revision: 0, segments: [], speakers })

    expect((await transcriptApi.get('job-1')).speakers).toEqual(speakers)
  })
})
