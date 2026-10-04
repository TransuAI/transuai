import type { DecisionExtraction, GeneratedOutput, Quiz, SpeakerInsights, Summary, Transcript } from '@/types/api'

// 過時（見 ai-service CONTEXT.md）：摘要跟章節是依據逐字稿的某個 revision 產生的；逐字稿之後又被編輯
// （revision 變大）就代表它們可能沒反映那些修改。章節跟摘要永遠一起產生，所以共用這個判斷。
export function isSummaryStale(summary: Summary | null, transcript: Transcript | null): boolean {
  return summary !== null && transcript !== null && summary.sourceRevision < transcript.revision
}

// 測驗也一樣：依據的逐字稿 revision 比目前的小就可能過時（仍然可以作答）。還沒完成的測驗還沒有依據的版本。
export function isQuizStale(quiz: Quiz, transcript: Transcript | null): boolean {
  return quiz.status === 'COMPLETED' && transcript !== null && quiz.sourceRevision < transcript.revision
}

// 講者數據的 AI 判斷：完成過一次才有結果可看（再分析中、或再分析失敗時，上一次的結果照樣在）。
export function hasSpeakerInsightResults(insights: SpeakerInsights | null): insights is SpeakerInsights {
  return insights !== null && (insights.status === 'COMPLETED' || insights.completedAt !== null)
}

// 依據的逐字稿 revision 比目前的小就可能過時（改講者也會讓 revision 變大）。
export function isSpeakerInsightsStale(insights: SpeakerInsights | null, transcript: Transcript | null): boolean {
  return hasSpeakerInsightResults(insights) && transcript !== null && insights.sourceRevision < transcript.revision
}

// 多格式輸出：依據的逐字稿 revision 比目前的小就可能過時（照常顯示，要新的就再產生一份）。還沒完成的還沒有依據的版本。
export function isOutputStale(output: GeneratedOutput, transcript: Transcript | null): boolean {
  return output.status === 'COMPLETED' && transcript !== null && output.sourceRevision < transcript.revision
}

// 決策紀錄：完成過一次（completedAt）才有依據的 revision；比逐字稿目前的小就可能過時（照常顯示，可以重新抽出）。
export function isDecisionsStale(extraction: DecisionExtraction | null, transcript: Transcript | null): boolean {
  return extraction !== null && extraction.completedAt !== null && transcript !== null
    && extraction.sourceRevision < transcript.revision
}
