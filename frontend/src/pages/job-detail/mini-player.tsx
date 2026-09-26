import { useCallback, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useMediaPlayback } from '@/hooks/use-media-playback'
import { formatDuration } from '@/lib/media'
import { Button } from '@/components/ui/button'
import type { FileType, Speaker } from '@/types/api'

interface MiniPlayerProps {
  fileType: FileType
  mediaUrl: string
  /** The job's recorded length, shown until the media element reports its own duration. */
  fallbackDuration: number
  setMediaRef: (el: HTMLMediaElement | null) => void
  currentSegmentText: string | null
  /** The current segment's speaker, when speakers are shown at all (two or more of them). */
  currentSpeaker: Speaker | null
}

// Narrow viewports only: a bar pinned under the Chat pane that owns the workspace's single
// media element, so playback survives closing the Source Sheet. Its own controls replace
// the native ones so they fit the bar.
export function MiniPlayer({
  fileType,
  mediaUrl,
  fallbackDuration,
  setMediaRef,
  currentSegmentText,
  currentSpeaker,
}: MiniPlayerProps) {
  const [media, setMedia] = useState<HTMLMediaElement | null>(null)
  const mediaRef = useCallback(
    (el: HTMLMediaElement | null) => {
      setMedia(el)
      setMediaRef(el)
    },
    [setMediaRef],
  )
  const { currentTime, duration, paused, seek } = useMediaPlayback(media)
  const totalDuration = duration ?? fallbackDuration

  return (
    <section aria-label="播放器" className="flex shrink-0 items-center gap-2 rounded-xl border bg-card p-2">
      {fileType === 'VIDEO' ? (
        <video ref={mediaRef} src={mediaUrl} playsInline className="aspect-video w-28 shrink-0 rounded-md bg-black" />
      ) : (
        <audio ref={mediaRef} src={mediaUrl} />
      )}
      <Button
        size="icon"
        variant="ghost"
        aria-label={paused ? '播放' : '暫停'}
        disabled={!media}
        onClick={() => (paused ? void media?.play() : media?.pause())}
      >
        {paused ? <Play /> : <Pause />}
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="min-h-5 truncate text-sm">
          {currentSpeaker && currentSegmentText && <span className="font-medium">{currentSpeaker.displayName}：</span>}
          {currentSegmentText}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="range"
            aria-label="播放進度"
            min={0}
            max={totalDuration}
            step={0.1}
            value={Math.min(currentTime, totalDuration)}
            disabled={!media}
            onChange={(event) => seek(Number(event.target.value))}
            className="h-1 min-w-0 flex-1 accent-primary"
          />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatDuration(currentTime)} / {formatDuration(totalDuration)}
          </span>
        </div>
      </div>
    </section>
  )
}
