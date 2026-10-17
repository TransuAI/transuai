import { useCallback, useEffect, useState } from 'react'

export interface MediaPlaybackState {
  currentTime: number
  duration: number | null
  paused: boolean
}

export interface MediaPlayback extends MediaPlaybackState {
  /** Seek, reflecting the new position right away rather than when the browser reports it. */
  seek: (seconds: number) => void
}

const EVENTS = ['timeupdate', 'seeked', 'durationchange', 'loadedmetadata', 'play', 'pause', 'ended'] as const

// Mirrors a media element's playback state into React state. It updates on every
// timeupdate (~4×/s), so only use it in small components such as the mini player, not
// at the workspace level.
export function useMediaPlayback(media: HTMLMediaElement | null): MediaPlayback {
  const [playback, setPlayback] = useState<MediaPlaybackState>({ currentTime: 0, duration: null, paused: true })

  useEffect(() => {
    if (!media) return
    const sync = () =>
      setPlayback({
        currentTime: media.currentTime,
        duration: Number.isFinite(media.duration) ? media.duration : null,
        paused: media.paused,
      })
    sync()
    EVENTS.forEach((event) => media.addEventListener(event, sync))
    return () => EVENTS.forEach((event) => media.removeEventListener(event, sync))
  }, [media])

  // A seek on a remote file only reports back (timeupdate/seeked) once enough has buffered;
  // until then a controlled progress bar would snap back to the old position mid-drag.
  const seek = useCallback(
    (seconds: number) => {
      if (!media) return
      media.currentTime = seconds
      setPlayback((current) => ({ ...current, currentTime: seconds }))
    },
    [media],
  )

  return { ...playback, seek }
}
