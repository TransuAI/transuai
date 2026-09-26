import type { Summary, Transcript } from '@/types/api'

// 過時（見 ai-service CONTEXT.md）：摘要跟章節是依據逐字稿的某個 revision 產生的；逐字稿之後又被編輯
// （revision 變大）就代表它們可能沒反映那些修改。章節跟摘要永遠一起產生，所以共用這個判斷。
export function isSummaryStale(summary: Summary | null, transcript: Transcript | null): boolean {
  return summary !== null && transcript !== null && summary.sourceRevision < transcript.revision
}
