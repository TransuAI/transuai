import { formatDuration } from '@/lib/media'

// A time in the recording that jumps playback there when clicked (citations in 問答, results of a 測驗).
export function TimestampButton({
  seconds,
  onSeek,
  mediaAvailable,
}: {
  seconds: number
  onSeek: (seconds: number) => void
  mediaAvailable: boolean
}) {
  return (
    <button
      type="button"
      disabled={!mediaAvailable}
      onClick={() => onSeek(seconds)}
      className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
    >
      {formatDuration(seconds)}
    </button>
  )
}
