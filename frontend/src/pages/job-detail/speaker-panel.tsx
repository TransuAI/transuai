import { hasMultipleSpeakers, speakersWithSegments } from '@/lib/speakers'
import { SpeakerDot } from '@/pages/job-detail/speaker-dot'
import type { Transcript } from '@/types/api'

// The job's speakers (講者) above the transcript, each with its colour. Not shown for a
// single-speaker recording.
export function SpeakerPanel({ transcript }: { transcript: Transcript }) {
  if (!hasMultipleSpeakers(transcript.segments)) return null
  return (
    <ul aria-label="講者" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {speakersWithSegments(transcript.segments, transcript.speakers).map((speaker) => (
        <li key={speaker.label} className="flex items-center gap-1.5">
          <SpeakerDot speaker={speaker} />
          {speaker.displayName}
        </li>
      ))}
    </ul>
  )
}
