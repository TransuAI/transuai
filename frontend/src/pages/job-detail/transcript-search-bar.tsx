import type { KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { TranscriptSearch } from '@/hooks/use-transcript-search'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function TranscriptSearchBar({ search }: { search: TranscriptSearch }) {
  const { query, changeQuery, matchCount, activeMatchIndex, step } = search

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      changeQuery('')
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Input
        type="search"
        aria-label="搜尋逐字稿"
        // While there's a query, Esc clears it instead of closing the Source Sheet.
        data-consumes-escape={query !== '' ? '' : undefined}
        placeholder="搜尋逐字稿"
        value={query}
        onChange={(event) => changeQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        className="h-8"
      />
      <span aria-live="polite" className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {matchCount > 0 ? `${activeMatchIndex + 1} / ${matchCount}` : query.trim() !== '' && '沒有符合的結果'}
      </span>
      {matchCount > 0 && (
        <>
          <Button size="icon-sm" variant="ghost" aria-label="上一個符合結果" onClick={() => step(-1)}>
            <ChevronUp />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="下一個符合結果" onClick={() => step(1)}>
            <ChevronDown />
          </Button>
        </>
      )}
    </div>
  )
}
