import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { FileAudio, UploadCloud } from 'lucide-react'
import { uploadApi } from '@/lib/api'
import { uploadToPresignedUrl } from '@/lib/api-client'
import { detectFileType, formatBytes, formatDuration, readMediaDuration } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { TranscriptionLanguage } from '@/types/api'

const MAX_DURATION_SECONDS = 60 * 60

// Speech recognition is told the language up front; guessing Chinese for an English meeting loses most of it.
const LANGUAGES: [TranscriptionLanguage, string][] = [
  ['zh-TW', '中文'],
  ['en', '英文'],
  ['auto', '自動偵測（中文或英文）'],
]

type Stage = 'idle' | 'reading' | 'presigning' | 'uploading' | 'finalizing'

export function UploadPage() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [language, setLanguage] = useState<TranscriptionLanguage>('zh-TW')

  const handleFile = async (candidate: File) => {
    const fileType = detectFileType(candidate)
    if (!fileType) {
      toast.error('只支援音訊或影片檔案')
      return
    }

    setFile(candidate)
    setStage('reading')
    try {
      const seconds = await readMediaDuration(candidate)
      if (seconds > MAX_DURATION_SECONDS) {
        toast.error('檔案長度限制在 60 分鐘以內')
        setFile(null)
        setStage('idle')
        return
      }
      setDuration(seconds)
      setStage('idle')
    } catch {
      toast.error('無法讀取檔案長度,請確認檔案是否毀損')
      setFile(null)
      setStage('idle')
    }
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const candidate = e.target.files?.[0]
    if (candidate) void handleFile(candidate)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const candidate = e.dataTransfer.files?.[0]
    if (candidate) void handleFile(candidate)
  }

  const startUpload = async () => {
    if (!file || duration === null) return
    const fileType = detectFileType(file)
    if (!fileType) return

    try {
      setStage('presigning')
      const presign = await uploadApi.presign({
        fileName: file.name,
        fileType,
        contentType: file.type,
        fileSizeBytes: file.size,
        durationSeconds: duration,
      })

      setStage('uploading')
      setProgress(0)
      await uploadToPresignedUrl(presign.uploadUrl, file, setProgress)

      setStage('finalizing')
      const job = await uploadApi.complete({
        storagePath: presign.storagePath,
        fileName: file.name,
        fileType,
        fileSizeBytes: file.size,
        durationSeconds: duration,
        transcriptionLanguage: language,
      })

      toast.success('上傳完成,開始處理中')
      navigate(`/jobs/${job.jobId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上傳失敗,請再試一次')
      setStage('idle')
    }
  }

  const isBusy = stage !== 'idle'

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>上傳音訊 / 影片</CardTitle>
          <CardDescription>檔案長度限制 60 分鐘以內(音訊檔 120MB、影片檔 1GB 以內),上傳後會自動產出逐字稿與摘要</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => !isBusy && inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
              isDragging ? 'border-primary bg-accent' : 'border-border'
            } ${isBusy ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={onInputChange}
            />
            {file ? (
              <>
                <FileAudio className="size-8 text-muted-foreground" />
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatBytes(file.size)}
                    {duration !== null && ` · ${formatDuration(duration)}`}
                  </p>
                </div>
              </>
            ) : (
              <>
                <UploadCloud className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  拖放檔案到這裡,或點擊選擇音訊 / 影片檔案
                </p>
              </>
            )}
          </div>

          <fieldset className="flex flex-col gap-1" disabled={isBusy}>
            <legend className="text-sm font-medium">錄音的語言</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {LANGUAGES.map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="transcription-language"
                    value={value}
                    checked={language === value}
                    onChange={() => setLanguage(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {language === 'auto' && (
              <span className="text-xs text-muted-foreground">
                整段錄音只會判斷成一種語言;判斷成中文時錯字會比選「中文」多,確定是中文請選「中文」
              </span>
            )}
          </fieldset>

          {stage === 'uploading' && <Progress value={progress} />}

          <Button
            onClick={startUpload}
            disabled={!file || duration === null || isBusy}
            className="w-full"
          >
            {stageLabel(stage)}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function stageLabel(stage: Stage): string {
  switch (stage) {
    case 'reading':
      return '讀取檔案中...'
    case 'presigning':
      return '準備上傳中...'
    case 'uploading':
      return '上傳中...'
    case 'finalizing':
      return '建立處理工作中...'
    default:
      return '開始上傳'
  }
}
