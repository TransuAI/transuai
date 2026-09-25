import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { LocateFixed } from 'lucide-react'
import type { AutoFollow } from '@/hooks/use-auto-follow'
import { useTranscriptSearch } from '@/hooks/use-transcript-search'
import { formatDuration } from '@/lib/media'
import type { TranscriptMatch } from '@/lib/transcript-search'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TranscriptSearchBar } from '@/pages/job-detail/transcript-search-bar'
import type { TranscriptSegment } from '@/types/api'

// Markup of the shadcn ScrollArea (components/ui/scroll-area.tsx) this view relies on.
const VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'
const SCROLLBAR_SELECTOR = '[data-slot="scroll-area-scrollbar"]'

// Keys that scroll the focused transcript viewport.
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '])

// A segment is only re-centred when it leaves this middle band of the viewport (as a
// fraction of its height from either edge), so segments changing every ~2 seconds during
// auto-follow don't make the transcript jitter.
const MIDDLE_BAND_EDGE = 0.3

function centerIfOutsideMiddleBand(viewport: HTMLElement, segment: HTMLElement, behavior: ScrollBehavior) {
  const viewportRect = viewport.getBoundingClientRect()
  const segmentRect = segment.getBoundingClientRect()
  const segmentCenter = segmentRect.top + segmentRect.height / 2 - viewportRect.top
  const edge = viewport.clientHeight * MIDDLE_BAND_EDGE
  if (segmentCenter >= edge && segmentCenter <= viewport.clientHeight - edge) return
  viewport.scrollTo({ top: viewport.scrollTop + segmentCenter - viewport.clientHeight / 2, behavior })
}

function HighlightedText({ text, matches, activeStart }: { text: string; matches: TranscriptMatch[]; activeStart: number | null }) {
  const parts = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) parts.push(text.slice(cursor, match.start))
    parts.push(
      <mark
        key={match.start}
        className={cn(
          'rounded-sm bg-search-match text-inherit',
          match.start === activeStart && 'bg-primary text-primary-foreground',
        )}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    )
    cursor = match.end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

interface TranscriptViewProps {
  segments: TranscriptSegment[]
  currentSegmentIndex: number | null
  autoFollow: AutoFollow
  mediaAvailable: boolean
  onSeek: (seconds: number) => void
}

export function TranscriptView({ segments, currentSegmentIndex, autoFollow, mediaAvailable, onSeek }: TranscriptViewProps) {
  const { isFollowing, pause, resume } = autoFollow
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const search = useTranscriptSearch(segments, pause)
  const { activeMatch, matchesBySegment } = search

  // Clicking the transcript text should give the viewport keyboard focus, so that a
  // following PageDown/Space — which the browser uses to scroll the viewport — also reaches
  // the key handler below instead of landing on <body> and silently scrolling past it.
  useEffect(() => {
    scrollAreaRef.current?.querySelector(VIEWPORT_SELECTOR)?.setAttribute('tabindex', '-1')
  }, [])

  // Positioning while mounting (e.g. opening the Source Sheet mid-recording) jumps straight
  // there; smooth-scrolling past hundreds of segments would just look slow. Everything after
  // that scrolls smoothly. isMountedRef flips in an effect declared after the positioning ones.
  const isMountedRef = useRef(false)
  const centerSegment = (segmentIndex: number) => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(VIEWPORT_SELECTOR)
    const segment = viewport?.querySelector<HTMLElement>(`[data-segment-index="${segmentIndex}"]`)
    if (viewport && segment) centerIfOutsideMiddleBand(viewport, segment, isMountedRef.current ? 'smooth' : 'instant')
  }

  useEffect(() => {
    if (isFollowing && currentSegmentIndex !== null) centerSegment(currentSegmentIndex)
  }, [currentSegmentIndex, isFollowing])

  // Bring the selected match into view — scrolling only, the playback position stays put.
  useEffect(() => {
    if (activeMatch) centerSegment(activeMatch.segmentIndex)
  }, [activeMatch])

  useEffect(() => {
    isMountedRef.current = true
  }, [])

  // Only user-initiated scrolling pauses auto-follow. Listening for the input events rather
  // than `scroll` means our own programmatic scrollTo above can never pause itself.
  const pauseOnWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) pause() // ctrl+wheel zooms the page instead of scrolling
  }
  const pauseOnScrollKey = (event: KeyboardEvent) => {
    if (!SCROLL_KEYS.has(event.key)) return
    // Space on a focused timestamp button clicks it, i.e. it's a jump, not scrolling.
    if (event.key === ' ' && (event.target as Element).closest('button')) return
    pause()
  }
  const pauseOnScrollbarDrag = (event: PointerEvent) => {
    if ((event.target as Element).closest(SCROLLBAR_SELECTOR)) pause()
  }

  return (
    <div className="relative flex h-full flex-col gap-3">
      <TranscriptSearchBar search={search} />
      <ScrollArea
        ref={scrollAreaRef}
        className="min-h-0 flex-1 pr-4"
        onWheel={pauseOnWheel}
        onTouchMove={pause}
        onKeyDown={pauseOnScrollKey}
        onPointerDown={pauseOnScrollbarDrag}
      >
        {/* pb-12 leaves room so the last segment can scroll above the floating 回到播放位置 button. */}
        <div className="flex flex-col gap-3 pb-12">
          {segments.map((segment, i) => (
            <div
              key={i}
              data-segment-index={i}
              aria-current={i === currentSegmentIndex ? 'true' : undefined}
              className={cn(
                '-mx-2 flex gap-3 rounded-md px-2 py-1 text-sm transition-colors',
                i === currentSegmentIndex && 'bg-primary/10',
              )}
            >
              <button
                type="button"
                disabled={!mediaAvailable}
                onClick={() => onSeek(segment.startTime)}
                className="h-fit shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-60"
              >
                {formatDuration(segment.startTime)}
              </button>
              <p className="leading-relaxed">
                {segment.speakerLabel && <span className="mr-1 font-medium">{segment.speakerLabel}:</span>}
                <HighlightedText
                  text={segment.text}
                  matches={matchesBySegment.get(i) ?? []}
                  activeStart={activeMatch?.segmentIndex === i ? activeMatch.start : null}
                />
              </p>
            </div>
          ))}
        </div>
      </ScrollArea>
      {!isFollowing && currentSegmentIndex !== null && (
        <Button
          size="sm"
          variant="secondary"
          onClick={resume}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-md"
        >
          <LocateFixed className="size-4" />
          回到播放位置
        </Button>
      )}
    </div>
  )
}
