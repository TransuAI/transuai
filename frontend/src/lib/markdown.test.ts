import { describe, expect, it } from 'vitest'
import { markdownToPlainText, parseInline, parseMarkdown } from './markdown'

const text = (t: string) => ({ kind: 'text', text: t })

describe('parseInline', () => {
  it('reads bold, italic and code', () => {
    expect(parseInline('答案是**上千枚**，見 `pgvector` 與 *附註*')).toEqual([
      text('答案是'),
      { kind: 'strong', children: [text('上千枚')] },
      text('，見 '),
      { kind: 'code', text: 'pgvector' },
      text(' 與 '),
      { kind: 'em', children: [text('附註')] },
    ])
  })

  it('reads italic inside bold', () => {
    expect(parseInline('**很*重要*的事**')).toEqual([
      { kind: 'strong', children: [text('很'), { kind: 'em', children: [text('重要')] }, text('的事')] },
    ])
  })

  it('leaves stars that do not hug their text alone', () => {
    expect(parseInline('3 * 4 * 5')).toEqual([text('3 * 4 * 5')])
  })

  it('shows a bold that is not closed yet (still streaming) as typed', () => {
    expect(parseInline('答案是**上千')).toEqual([text('答案是**上千')])
  })
})

describe('parseMarkdown', () => {
  it('keeps consecutive lines in one paragraph and splits paragraphs on a blank line', () => {
    expect(parseMarkdown('第一行\n第二行\n\n第二段')).toEqual([
      { kind: 'paragraph', lines: [[text('第一行')], [text('第二行')]] },
      { kind: 'paragraph', lines: [[text('第二段')]] },
    ])
  })

  it('reads quotes, as the answers quote the transcript', () => {
    expect(parseMarkdown('相關內容如下：\n> [0.0s] 上千枚\n> [1.7s] 一瞬間')).toEqual([
      { kind: 'paragraph', lines: [[text('相關內容如下：')]] },
      { kind: 'quote', lines: [[text('[0.0s] 上千枚')], [text('[1.7s] 一瞬間')]] },
    ])
  })

  it('reads bulleted and numbered lists, an indented line carrying on its item', () => {
    expect(parseMarkdown('- 甲\n* 乙\n  續\n\n3. 丙\n4) 丁')).toEqual([
      { kind: 'list', ordered: false, start: 1, items: [[text('甲')], [text('乙 續')]] },
      { kind: 'list', ordered: true, start: 3, items: [[text('丙')], [text('丁')]] },
    ])
  })

  it('does not take a line that opens with bold for a list item', () => {
    expect(parseMarkdown('**重點**：預算')).toEqual([
      { kind: 'paragraph', lines: [[{ kind: 'strong', children: [text('重點')] }, text('：預算')]] },
    ])
  })

  it('reads headings and rules', () => {
    expect(parseMarkdown('## 結論\n---\n好')).toEqual([
      { kind: 'heading', content: [text('結論')] },
      { kind: 'rule' },
      { kind: 'paragraph', lines: [[text('好')]] },
    ])
  })
})

describe('markdownToPlainText', () => {
  it('drops the marks, keeping the words in one line', () => {
    expect(markdownToPlainText('## 結論\n\n預算**砍一成**。\n> 引用\n- 甲\n- 乙')).toBe('結論 預算砍一成。 引用 甲 乙')
  })
})
