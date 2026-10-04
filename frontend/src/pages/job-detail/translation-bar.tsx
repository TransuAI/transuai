import { useState } from 'react'
import { Languages, Loader2Icon, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { TranscriptDisplay, TranslationsActions } from '@/hooks/use-translations'
import { TRANSLATION_LANGUAGES } from '@/lib/translation-languages'
import type { TranslationLanguage } from '@/types/api'

// 譯文: above the transcript — what it shows (原文, a language's 譯文 in its place, or 雙語 under each segment), starting a
// translation into another language, how each one is coming along, and deleting the shown one (after confirming).
export function TranslationBar({ translations: actions }: { translations: TranslationsActions }) {
  const { translations, display, setDisplay, isRequesting, request, remove } = actions
  const [deleting, setDeleting] = useState<TranslationLanguage | null>(null)
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
        {display.mode !== 'original' && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`刪除${TRANSLATION_LANGUAGES[display.language]}譯文`}
            title="刪除這種語言的譯文"
            onClick={() => setDeleting(display.language)}
          >
            <Trash2 />
          </Button>
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
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除{deleting && TRANSLATION_LANGUAGES[deleting]}譯文？</AlertDialogTitle>
            <AlertDialogDescription>這種語言已經翻好的片段都會刪掉，之後要再看得重新翻譯。逐字稿原文不受影響。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && void remove(deleting)}>刪除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function parseDisplay(value: string): TranscriptDisplay {
  if (value === 'original') return { mode: 'original' }
  const [mode, language] = value.split(':') as ['translated' | 'bilingual', TranslationLanguage]
  return { mode, language }
}
