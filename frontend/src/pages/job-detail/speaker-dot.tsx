import { speakerColour } from '@/lib/speakers'
import { cn } from '@/lib/utils'
import type { Speaker } from '@/types/api'

export function SpeakerDot({ speaker, className }: { speaker: Speaker; className?: string }) {
  return (
    <span
      aria-hidden
      data-speaker-colour
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: speakerColour(speaker) }}
    />
  )
}
