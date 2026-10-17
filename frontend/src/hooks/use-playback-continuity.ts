import { useEffect, useRef } from 'react'

// The Job workspace remounts its single media element when the layout switches between
// desktop (Source pane) and narrow (mini player). This remembers where playback was, and
// whether it was playing, and carries both over to the next element — resizing the window
// shouldn't interrupt listening.
export function usePlaybackContinuity(media: HTMLMediaElement | null) {
  const lastTimeRef = useRef(0)
  const wasPlayingRef = useRef(false)

  useEffect(() => {
    if (!media) return
    if (lastTimeRef.current > 0 && media.currentTime === 0) media.currentTime = lastTimeRef.current
    if (wasPlayingRef.current) void media.play()

    const listeners: [string, () => void][] = [
      ['timeupdate', () => (lastTimeRef.current = media.currentTime)],
      ['seeked', () => (lastTimeRef.current = media.currentTime)],
      ['play', () => (wasPlayingRef.current = true)],
      // Browsers pause a media element when it's removed from the document; that pause is the
      // remount itself, not the user, so it mustn't clear the "was playing" memory.
      ['pause', () => media.isConnected && (wasPlayingRef.current = false)],
    ]
    listeners.forEach(([event, listener]) => media.addEventListener(event, listener))
    return () => {
      lastTimeRef.current = media.currentTime
      listeners.forEach(([event, listener]) => media.removeEventListener(event, listener))
    }
  }, [media])
}
