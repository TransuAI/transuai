// The bit of Markdown the models write in their answers and summaries (粗體、引用、清單、標題、行內程式碼), read into
// blocks to show as such instead of as raw ** and >. Anything else (tables, links, HTML) stays plain text: nothing here
// ever becomes markup of its own, so it's safe to show whatever a model sends. While an answer streams in, a ** that
// isn't closed yet just shows as typed until its other half arrives.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }

export type Block =
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'heading'; content: Inline[] }
  | { kind: 'quote'; lines: Inline[][] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { kind: 'rule' }

const HEADING = /^#{1,6}\s+(.+)$/
const QUOTE = /^\s*>\s?(.*)$/
const BULLET = /^\s*[-*+]\s+(.+)$/
const NUMBERED = /^\s*(\d+)[.)]\s+(.+)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = []
  // Lines and items are gathered as text and read inline once the block is whole.
  let open: { kind: 'paragraph' | 'quote'; lines: string[] } | { kind: 'list'; ordered: boolean; start: number; items: string[] } | null =
    null
  const close = () => {
    if (!open) return
    if (open.kind === 'list') blocks.push({ ...open, items: open.items.map(parseInline) })
    else blocks.push({ kind: open.kind, lines: open.lines.map(parseInline) })
    open = null
  }

  for (const line of text.split('\n')) {
    let match: RegExpExecArray | null
    if (line.trim() === '') {
      close()
    } else if (RULE.test(line)) {
      close()
      blocks.push({ kind: 'rule' })
    } else if ((match = HEADING.exec(line))) {
      close()
      blocks.push({ kind: 'heading', content: parseInline(match[1].trim()) })
    } else if ((match = QUOTE.exec(line))) {
      if (open?.kind !== 'quote') {
        close()
        open = { kind: 'quote', lines: [] }
      }
      open.lines.push(match[1])
    } else if ((match = BULLET.exec(line)) || (match = NUMBERED.exec(line))) {
      const ordered = match.length === 3
      const itemText = ordered ? match[2] : match[1]
      if (open?.kind !== 'list' || open.ordered !== ordered) {
        close()
        open = { kind: 'list', ordered, start: ordered ? Number(match[1]) : 1, items: [] }
      }
      open.items.push(itemText)
    } else if (open?.kind === 'list' && /^\s/.test(line)) {
      // An indented line under an item carries on that item.
      open.items[open.items.length - 1] += ` ${line.trim()}`
    } else {
      if (open?.kind !== 'paragraph') {
        close()
        open = { kind: 'paragraph', lines: [] }
      }
      open.lines.push(line)
    }
  }
  close()
  return blocks
}

// `code`, **strong** and *em*. The marks have to hug their text (「3 * 4 * 5」 stays as it is).
const INLINE = /`([^`\n]+)`|\*\*(\S(?:[\s\S]*?\S)?)\*\*|\*([^\s*](?:[^*\n]*?[^\s*])?)\*/g

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE)) {
    if (match.index > cursor) parts.push({ kind: 'text', text: text.slice(cursor, match.index) })
    const [, code, strong, em] = match
    if (code !== undefined) parts.push({ kind: 'code', text: code })
    else if (strong !== undefined) parts.push({ kind: 'strong', children: parseInline(strong) })
    else parts.push({ kind: 'em', children: parseInline(em) })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) })
  return parts
}

/** The text without its Markdown marks, for a one-line preview (the Studio's 摘要 tile). */
export function markdownToPlainText(text: string): string {
  const inline = (parts: Inline[]): string =>
    parts.map((part) => (part.kind === 'text' || part.kind === 'code' ? part.text : inline(part.children))).join('')
  return parseMarkdown(text)
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return inline(block.content)
        case 'list':
          return block.items.map(inline).join(' ')
        case 'rule':
          return ''
        default:
          return block.lines.map(inline).join(' ')
      }
    })
    .filter(Boolean)
    .join(' ')
}
