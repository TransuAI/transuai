import type { OutputFormat, SocialPlatform } from '@/types/api'

// 多格式輸出 (see ai-service CONTEXT.md): what each kind is called on screen and in a downloaded file's name.
export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  podcast_description: 'Podcast 介紹',
  youtube_description: 'YouTube 描述',
  blog_post: '部落格文章',
  newsletter: '電子報',
  social_post: '社群貼文',
}

// A social post is written for one platform: its length limit (the same numbers the prompt gives the model).
export const SOCIAL_PLATFORMS: Record<SocialPlatform, { name: string; limit: number }> = {
  threads: { name: 'Threads', limit: 500 },
  facebook: { name: 'Facebook', limit: 63206 },
  instagram: { name: 'Instagram', limit: 2200 },
  linkedin: { name: 'LinkedIn', limit: 3000 },
  x: { name: 'X', limit: 280 },
}

export function outputLabel(format: OutputFormat, platform: SocialPlatform | null): string {
  const label = OUTPUT_FORMAT_LABELS[format] ?? format
  return format === 'social_post' && platform ? `${label}（${SOCIAL_PLATFORMS[platform]?.name ?? platform}）` : label
}

// Chinese, Japanese and Korean characters (and full-width forms), which X counts as two.
const WIDE = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-￯]/u

/** How long a post is by the platform's own count, against its limit (counted by character, so an emoji is one). */
export function postLength(text: string, platform: SocialPlatform): { length: number; limit: number; over: boolean } {
  const characters = Array.from(text.trimEnd())
  const length = platform === 'x' ? characters.reduce((sum, ch) => sum + (WIDE.test(ch) ? 2 : 1), 0) : characters.length
  const { limit } = SOCIAL_PLATFORMS[platform]
  return { length, limit, over: length > limit }
}
