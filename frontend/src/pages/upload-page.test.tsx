import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadApi } from '@/lib/api'
import { UploadPage } from './upload-page'

vi.mock('@/lib/api', () => ({
  uploadApi: { presign: vi.fn(), complete: vi.fn() },
}))

vi.mock('@/lib/api-client', () => ({
  uploadToPresignedUrl: vi.fn().mockResolvedValue(undefined),
}))

// jsdom can't read a media file's duration; the page only needs the number.
vi.mock('@/lib/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/media')>()),
  readMediaDuration: vi.fn().mockResolvedValue(24 * 60),
}))

beforeEach(() => {
  vi.mocked(uploadApi.presign).mockResolvedValue({
    uploadUrl: 'http://minio/put',
    storagePath: 'uploads/u/meeting.m4a',
    expiresAt: '2026-01-01T00:15:00Z',
  })
  vi.mocked(uploadApi.complete).mockResolvedValue({ jobId: 'job-1' } as Awaited<ReturnType<typeof uploadApi.complete>>)
})

async function chooseFile() {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <UploadPage />
    </MemoryRouter>,
  )
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(input, new File(['audio'], 'meeting.m4a', { type: 'audio/mp4' }))
  await screen.findByText('meeting.m4a')
  return user
}

describe('UploadPage transcription language (轉錄語言)', () => {
  it('transcribes in Chinese unless told otherwise', async () => {
    const user = await chooseFile()

    expect(screen.getByRole('radio', { name: '中文' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: '開始上傳' }))

    expect(uploadApi.complete).toHaveBeenCalledWith(expect.objectContaining({ transcriptionLanguage: 'zh-TW' }))
  })

  it.each([
    ['英文', 'en'],
    ['自動偵測（中文或英文）', 'auto'],
  ])('passes on %s', async (label, language) => {
    const user = await chooseFile()

    await user.click(screen.getByRole('radio', { name: label }))
    await user.click(screen.getByRole('button', { name: '開始上傳' }))

    expect(uploadApi.complete).toHaveBeenCalledWith(expect.objectContaining({ transcriptionLanguage: language }))
  })
})
