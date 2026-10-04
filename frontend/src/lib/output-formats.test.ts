import { describe, expect, it } from 'vitest'
import { outputLabel, postLength } from '@/lib/output-formats'

describe('postLength', () => {
  it('counts characters, so an emoji is one', () => {
    expect(postLength('預算🎉', 'threads')).toEqual({ length: 3, limit: 500, over: false })
  })

  it('counts Chinese, Japanese and Korean characters twice on X, as X does', () => {
    expect(postLength('預算 ok', 'x')).toEqual({ length: 7, limit: 280, over: false })
    expect(postLength('字'.repeat(141), 'x').over).toBe(true)
  })
})

describe('outputLabel', () => {
  it('names a social post after its platform', () => {
    expect(outputLabel('social_post', 'linkedin')).toBe('社群貼文（LinkedIn）')
    expect(outputLabel('blog_post', null)).toBe('部落格文章')
  })
})
