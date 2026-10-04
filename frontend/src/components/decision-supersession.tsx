import { Link } from 'react-router-dom'
import { decisionHref } from '@/lib/decision-links'
import { jobDate } from '@/lib/job-display'
import type { Decision, DecisionLink } from '@/types/api'

// 取代 (see ai-service CONTEXT.md「取代」): what a decision changed from an earlier meeting, and what later changed it —
// each a link to that decision in its own job.
export function DecisionSupersession({ decision }: { decision: Decision }) {
  if (!decision.supersedes && decision.supersededBy.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {decision.supersedes && (
        <p>
          取代了：<DecisionLinkTo link={decision.supersedes} />
        </p>
      )}
      {decision.supersededBy.map((link) => (
        <p key={link.id}>
          已被取代：<DecisionLinkTo link={link} />
        </p>
      ))}
    </div>
  )
}

function DecisionLinkTo({ link }: { link: DecisionLink }) {
  return (
    <Link to={decisionHref(link.jobId, link.id)} className="text-foreground/80 underline-offset-2 hover:underline">
      {link.meetingAt && jobDate(link.meetingAt)}「{link.statement}」
    </Link>
  )
}
