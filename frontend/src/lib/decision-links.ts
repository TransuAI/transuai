// Where a decision lives: its job, opened at it in 決策 — and, when it has one, at the time it was made.
export function decisionHref(jobId: string, decisionId: string, startTime?: number | null): string {
  return startTime === undefined || startTime === null
    ? `/jobs/${jobId}?decision=${decisionId}`
    : `/jobs/${jobId}?t=${startTime}&decision=${decisionId}`
}
