import type { OutputFormat } from '@/types/api'

// 多格式輸出 (see ai-service CONTEXT.md): what each kind is called on screen and in a downloaded file's name.
export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  podcast_description: 'Podcast 介紹',
}
