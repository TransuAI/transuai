// 「由 AI 回答／產生」 under what a model wrote. Which model it was matters only to those who switch models, so it's on
// hover (and read out to screen readers) rather than in every line.
export function ModelCredit({ model, verb }: { model: string; verb: '回答' | '產生' }) {
  return (
    <p title={`模型：${model}`} className="w-fit text-xs text-muted-foreground/80">
      由 AI {verb}
      <span className="sr-only">（模型：{model}）</span>
    </p>
  )
}
