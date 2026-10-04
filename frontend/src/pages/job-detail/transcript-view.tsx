import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { LocateFixed } from 'lucide-react'
import type { AutoFollow } from '@/hooks/use-auto-follow'
import { useTranscriptSearch } from '@/hooks/use-transcript-search'
import { notesBySegment } from '@/lib/notes'
import { speakersAtTurns, speakersWithSegments } from '@/lib/speakers'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SegmentRow } from '@/pages/job-detail/segment-row'
import { TranscriptSearchBar } from '@/pages/job-detail/transcript-search-bar'
import type { Note, Speaker, SpeakerAssignment, TranscriptSegment } from '@/types/api'

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

const NO_NOTES: Note[] = []

interface TranscriptViewProps {
  segments: TranscriptSegment[]
  speakers: Speaker[]
  currentSegmentIndex: number | null
  autoFollow: AutoFollow
  mediaAvailable: boolean
  onSeek: (seconds: number) => void
  onSaveSegmentText: (segmentId: string, text: string) => Promise<void>
  onAssignSpeaker: (segmentId: string, assignment: SpeakerAssignment) => Promise<void>
  notes: Note[]
  onAddNoteAt: (seconds: number) => void
  onOpenNote: (noteId: string) => void
  /** 譯文 shown in place of each segment's text, or under it (雙語); null shows the original. */
  translation?: { mode: 'translated' | 'bilingual'; texts: Map<string, string> } | null
}

// 譯文 in place of the text: search, highlighting and the rest work on what's shown. Not yet translated segments keep the
// original; the original-text marker (已編輯) is left out — the shown text isn't the transcript's own.
function translatedSegments(segments: TranscriptSegment[], texts: Map<string, string>): TranscriptSegment[] {
  return segments.map((segment) => {
    const text = texts.get(segment.id)
    return text === undefined || segment.text === '' ? segment : { ...segment, text, originalText: text }
  })
}

export function TranscriptView({
  segments: transcriptSegments,
  speakers,
  currentSegmentIndex,
  autoFollow,
  mediaAvailable,
  onSeek,
  onSaveSegmentText,
  onAssignSpeaker,
  notes,
  onAddNoteAt,
  onOpenNote,
  translation = null,
}: TranscriptViewProps) {
  const { isFollowing, pause, resume } = autoFollow
  const showsTranslationInstead = translation?.mode === 'translated'
  const segments = useMemo(
    () => (showsTranslationInstead ? translatedSegments(transcriptSegments, translation.texts) : transcriptSegments),
    [showsTranslationInstead, transcriptSegments, translation],
  )
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const search = useTranscriptSearch(segments, pause)
  const { activeMatch, matchesBySegment } = search
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null)
  const turnSpeakers = useMemo(() => speakersAtTurns(segments, speakers), [segments, speakers])
  // The same speakers as the speaker panel lists, even for a single-speaker recording.
  const speakerChoices = useMemo(() => speakersWithSegments(segments, speakers), [segments, speakers])
  const segmentNotes = useMemo(() => notesBySegment(notes, segments), [notes, segments])

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

  // While a segment is being edited, don't scroll it away — not even when a jump (which resumes
  // auto-follow) moves the playback elsewhere. Following picks up again once the edit ends.
  useEffect(() => {
    if (isFollowing && currentSegmentIndex !== null && editingSegmentId === null) centerSegment(currentSegmentIndex)
  }, [currentSegmentIndex, isFollowing, editingSegmentId])

  // Bring the selected match into view — scrolling only, the playback position stays put.
  // Keyed on the match's position, not the object: saving an edit recomputes every match, and
  // that alone mustn't scroll the transcript over to the selected one.
  const activeMatchSegment = activeMatch?.segmentIndex
  const activeMatchStart = activeMatch?.start
  useEffect(() => {
    if (activeMatchSegment !== undefined) centerSegment(activeMatchSegment)
  }, [activeMatchSegment, activeMatchStart])

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
        className="min-h-0 flex-1 pr-3"
        onWheel={pauseOnWheel}
        onTouchMove={pause}
        onKeyDown={pauseOnScrollKey}
        onPointerDown={pauseOnScrollbarDrag}
      >
        {/* pb-12 leaves room so the last segment can scroll above the floating 回到播放位置 button. */}
        <div className="flex flex-col gap-0.5 pb-12">
          {segments.map((segment, i) => (
            <SegmentRow
              key={segment.id}
              segment={segment}
              turnSpeaker={turnSpeakers[i]}
              index={i}
              isCurrent={i === currentSegmentIndex}
              matches={matchesBySegment.get(i) ?? []}
              activeMatchStart={activeMatch?.segmentIndex === i ? activeMatch.start : null}
              mediaAvailable={mediaAvailable}
              onSeek={onSeek}
              isEditing={editingSegmentId === segment.id}
              onStartEdit={() => {
                // Editing is reading closely, not following: pause, but leave playback running.
                pause()
                setEditingSegmentId(segment.id)
              }}
              // Only close this segment's editor: a save that finishes after the user has moved on
              // to another segment must not close that one.
              onEndEdit={() => setEditingSegmentId((current) => (current === segment.id ? null : current))}
              onSave={(text) => onSaveSegmentText(segment.id, text)}
              speakerChoices={speakerChoices}
              onAssignSpeaker={(assignment) => onAssignSpeaker(segment.id, assignment)}
              notes={segmentNotes.get(i) ?? NO_NOTES}
              onAddNote={() => onAddNoteAt(segment.startTime)}
              onOpenNote={onOpenNote}
              translation={translation?.mode === 'bilingual' ? (translation.texts.get(segment.id) ?? null) : null}
              textEditable={!showsTranslationInstead}
            />
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
