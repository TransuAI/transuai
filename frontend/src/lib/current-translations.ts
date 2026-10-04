import type { Transcript, TranslationDetail } from '@/types/api'

/** Segment id → translation, leaving out those translated from text that has since been edited (out of date until
 *  ai-service re-translates them). */
export function currentTranslations(
  translated: TranslationDetail['segments'],
  transcript: Pick<Transcript, 'segments'> | null,
): Map<string, string> {
  const current = new Map(transcript?.segments.map((s) => [s.id, s.text]))
  return new Map(translated.filter((s) => current.get(s.segmentId) === s.sourceText).map((s) => [s.segmentId, s.text]))
}
