import type { TranslationLanguage } from '@/types/api'

// 譯文: the languages on offer, by their own names (the same list the server accepts).
export const TRANSLATION_LANGUAGES: Record<TranslationLanguage, string> = {
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
}
