import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileText, Sparkles } from 'lucide-react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SourcePane } from '@/pages/job-detail/source-pane'
import { ChatPane, type QaEntry } from '@/pages/job-detail/chat-pane'
import { StudioPane } from '@/pages/job-detail/studio-pane'
import type { Chapter, Job, Summary, Transcript } from '@/types/api'

interface CompletedWorkspaceProps {
  job: Job
  mediaUrl: string | undefined
  mediaAvailable: boolean
  transcript: Transcript | null
  summary: Summary | null
  chapters: Chapter[]
  qaHistory: QaEntry[]
  isLoadingHistory: boolean
  questionInput: string
  onQuestionInputChange: (value: string) => void
  isAsking: boolean
  onAsk: () => void
  onSeek: (seconds: number) => void
  setMediaRef: (el: HTMLMediaElement | null) => void
}

// The desktop grid and the mobile Sheets are mutually exclusive mount points for
// SourcePane/StudioPane (never both at once) so there is only ever one <audio>/<video>
// element in the tree — otherwise the two instances would race to own mediaRef. The
// Sheets are force-closed the moment isDesktop flips, computed during render (not a
// useEffect) so the close happens in the same commit as the grid mounting its own
// media element, instead of a render later where both could briefly coexist.
export function CompletedWorkspace({
  job,
  mediaUrl,
  mediaAvailable,
  transcript,
  summary,
  chapters,
  qaHistory,
  isLoadingHistory,
  questionInput,
  onQuestionInputChange,
  isAsking,
  onAsk,
  onSeek,
  setMediaRef,
}: CompletedWorkspaceProps) {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [lastIsDesktop, setLastIsDesktop] = useState(isDesktop)

  if (isDesktop !== lastIsDesktop) {
    setLastIsDesktop(isDesktop)
    if (isDesktop) {
      setSourceOpen(false)
      setStudioOpen(false)
    }
  }

  const chatPane = (
    <ChatPane
      qaHistory={qaHistory}
      isLoadingHistory={isLoadingHistory}
      questionInput={questionInput}
      onQuestionInputChange={onQuestionInputChange}
      isAsking={isAsking}
      onAsk={onAsk}
      onSeek={onSeek}
      mediaAvailable={mediaAvailable}
    />
  )

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[32rem] flex-col gap-4 md:h-[calc(100vh-3rem)]">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="w-fit -ml-2">
          <Link to="/jobs">
            <ArrowLeft className="size-4" />
            返回列表
          </Link>
        </Button>

        <div className="flex items-center gap-2 lg:hidden">
          <Button variant="outline" size="sm" onClick={() => setSourceOpen(true)}>
            <FileText className="size-4" />
            來源
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStudioOpen(true)}>
            <Sparkles className="size-4" />
            Studio
          </Button>
        </div>
      </div>

      {isDesktop ? (
        <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)_20rem] gap-4">
          <SourcePane job={job} mediaUrl={mediaUrl} transcript={transcript} setMediaRef={setMediaRef} onSeek={onSeek} />
          {chatPane}
          <StudioPane summary={summary} chapters={chapters} onSeek={onSeek} mediaAvailable={mediaAvailable} />
        </div>
      ) : (
        <div className="min-h-0 flex-1">{chatPane}</div>
      )}

      <Sheet open={sourceOpen} onOpenChange={setSourceOpen}>
        <SheetContent side="left" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetTitle className="sr-only">Source</SheetTitle>
          <SourcePane job={job} mediaUrl={mediaUrl} transcript={transcript} setMediaRef={setMediaRef} onSeek={onSeek} />
        </SheetContent>
      </Sheet>

      <Sheet open={studioOpen} onOpenChange={setStudioOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetTitle className="sr-only">Studio</SheetTitle>
          <StudioPane summary={summary} chapters={chapters} onSeek={onSeek} mediaAvailable={mediaAvailable} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
