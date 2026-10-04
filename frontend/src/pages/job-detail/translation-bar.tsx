import { Languages, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TranscriptDisplay, TranslationsActions } from '@/hooks/use-translations'
import { TRANSLATION_LANGUAGES } from '@/lib/translation-languages'
import type { TranslationLanguage } from '@/types/api'

// 譯文: above the transcript — what it shows (原文, a language's 譯文 in its place, or 雙語 under each segment), starting a
// translation into another language, and how each one is coming along.
export function TranslationBar({ translations: actions }: { translations: TranslationsActions }) {
  const { translations, display, setDisplay, isRequesting, request } = actions
  const notYet = (Object.keys(TRANSLATION_LANGUAGES) as TranslationLanguage[]).filter(
    (language) => !translations.some((t) => t.language === language),
  )
  const displayValue = display.mode === 'original' ? 'original' : `${display.mode}:${display.language}`

  return (
    <div className="flex flex-col gap-1.5 pb-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Languages className="size-4 text-muted-foreground" aria-hidden />
        {translations.length > 0 && (
          <select
            aria-label="顯示"
            value={displayValue}
            onChange={(event) => setDisplay(parseDisplay(event.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="original">原文</option>
            {translations.map((t) => (
              <optgroup key={t.language} label={TRANSLATION_LANGUAGES[t.language]}>
                <option value={`translated:${t.language}`}>{`譯文（${TRANSLATION_LANGUAGES[t.language]}）`}</option>
                <option value={`bilingual:${t.language}`}>{`雙語（${TRANSLATION_LANGUAGES[t.language]}）`}</option>
              </optgroup>
            ))}
          </select>
        )}
        {notYet.length > 0 && (
          <select
            aria-label="翻譯成"
            value=""
            disabled={isRequesting}
            onChange={(event) => event.target.value && request(event.target.value as TranslationLanguage)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">翻譯成…</option>
            {notYet.map((language) => (
              <option key={language} value={language}>{TRANSLATION_LANGUAGES[language]}</option>
            ))}
          </select>
        )}
      </div>
      {translations.map((t) =>
        t.status === 'GENERATING' ? (
          <p key={t.language} className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <Loader2Icon className="size-3.5 animate-spin" />
            {`翻譯成${TRANSLATION_LANGUAGES[t.language]}中… ${t.translatedSegments}/${t.totalSegments}`}
          </p>
        ) : t.status === 'FAILED' ? (
          <div key={t.language} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-destructive">{t.failureReason ?? '翻譯失敗'}</span>
            <Button size="xs" variant="outline" disabled={isRequesting} onClick={() => request(t.language)}>
              再翻譯一次
            </Button>
          </div>
        ) : null,
      )}
    </div>
  )
}

function parseDisplay(value: string): TranscriptDisplay {
  if (value === 'original') return { mode: 'original' }
  const [mode, language] = value.split(':') as ['translated' | 'bilingual', TranslationLanguage]
  return { mode, language }
}
