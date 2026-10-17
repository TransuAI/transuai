import { Fragment, type ReactNode } from 'react'
import { parseMarkdown, type Inline } from '@/lib/markdown'
import { cn } from '@/lib/utils'

interface MarkdownTextProps {
  text: string
  /** Turns a run of plain text into what's shown, e.g. an answer's [n] into links to its web sources. */
  renderText?: (text: string) => ReactNode
  className?: string
}

const asIs = (text: string) => text

// A model's answer or summary, its Markdown (see lib/markdown.ts) shown as bold, quotes, lists and so on.
export function MarkdownText({ text, renderText = asIs, className }: MarkdownTextProps) {
  const inline = (parts: Inline[]): ReactNode =>
    parts.map((part, i) => {
      switch (part.kind) {
        case 'text':
          return <Fragment key={i}>{renderText(part.text)}</Fragment>
        case 'strong':
          return <strong key={i} className="font-semibold text-foreground">{inline(part.children)}</strong>
        case 'em':
          return <em key={i}>{inline(part.children)}</em>
        case 'code':
          return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{part.text}</code>
      }
    })
  const lines = (all: Inline[][]) =>
    all.map((line, i) => (
      <Fragment key={i}>
        {i > 0 && <br />}
        {inline(line)}
      </Fragment>
    ))

  return (
    <div className={cn('flex flex-col gap-2 break-words', className)}>
      {parseMarkdown(text).map((block, i) => {
        switch (block.kind) {
          case 'paragraph':
            return <p key={i}>{lines(block.lines)}</p>
          case 'heading':
            return <p key={i} className="font-semibold text-foreground">{inline(block.content)}</p>
          case 'quote':
            return (
              <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground">
                {lines(block.lines)}
              </blockquote>
            )
          case 'list': {
            const items = block.items.map((item, j) => <li key={j}>{inline(item)}</li>)
            return block.ordered ? (
              <ol key={i} start={block.start} className="flex list-decimal flex-col gap-1 pl-5">
                {items}
              </ol>
            ) : (
              <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
                {items}
              </ul>
            )
          }
          case 'rule':
            return <hr key={i} />
        }
      })}
    </div>
  )
}
