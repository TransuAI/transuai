import { useEffect, useState, type FormEvent } from 'react'
import { Cpu } from 'lucide-react'
import { toast } from 'sonner'
import { modelsApi } from '@/lib/api'
import { modelLabel, sameModel } from '@/lib/providers'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AvailableModels, ModelChoice } from '@/types/api'

// 預設模型 (see ai-service CONTEXT.md): what the summary and chapters after an upload, regenerating them and
// Q&A run on. Changing it doesn't redo anything already made. `keysVersion` changes whenever
// the user's own keys do, which changes what can be picked.
export function DefaultModelSection({ keysVersion }: { keysVersion: number }) {
  const [available, setAvailable] = useState<AvailableModels | null>(null)
  const [current, setCurrent] = useState<ModelChoice | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [openrouterDraft, setOpenrouterDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([modelsApi.available(), modelsApi.getDefault()])
      .then(([models, defaultModel]) => {
        setAvailable(models)
        setCurrent(defaultModel)
      })
      .catch(() => toast.error('無法載入模型清單'))
  }, [keysVersion])

  const choose = async (provider: string, model: string) => {
    setIsSaving(true)
    setError(null)
    try {
      const chosen = await modelsApi.setDefault(provider, model)
      setCurrent(chosen)
      toast.success(`預設模型已改成 ${chosen.model}`)
      return true
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '設定失敗')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const chooseOpenrouterModel = async (event: FormEvent) => {
    event.preventDefault()
    if (openrouterDraft.trim() && (await choose('openrouter', openrouterDraft.trim()))) setOpenrouterDraft('')
  }

  // The current default may be an OpenRouter model that isn't in any list: show it as a choice anyway.
  const choices = available?.models ?? []
  const listed = current && !choices.some((choice) => sameModel(current, choice)) ? [...choices, current] : choices

  return (
    <section aria-labelledby="default-model-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="default-model-heading" className="flex items-center gap-2 text-base font-medium">
          <Cpu className="size-4" />
          預設模型
        </h2>
        <p className="text-sm text-muted-foreground">
          上傳後的摘要與章節、重新產生、問答都用這個模型。換模型不會重做已經產生的內容；想用新模型重做，請在檔案的工作區裡按「重新產生摘要與章節」。
        </p>
      </div>
      {/* Nothing to pick between: say which model it is, and how to get others, instead of a lone radio button. */}
      {listed.length === 1 && !available?.openrouterCustom ? (
        <p className="rounded-lg border p-3 text-sm">
          目前使用 <span className="font-medium">{modelLabel(listed[0])}</span>。在下方「自有金鑰」存入 AI 廠商的金鑰後，就能改用其他模型。
        </p>
      ) : (
      <fieldset disabled={isSaving || !available} className="flex flex-col gap-1.5 rounded-lg border p-3">
        <legend className="sr-only">預設模型</legend>
        {listed.map((choice) => (
          <label key={`${choice.provider}/${choice.model}`} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="default-model"
              checked={sameModel(current, choice)}
              onChange={() => void choose(choice.provider, choice.model)}
            />
            {modelLabel(choice)}
          </label>
        ))}
      </fieldset>
      )}
      {available?.openrouterCustom && (
        <form onSubmit={(event) => void chooseOpenrouterModel(event)} className="flex flex-wrap gap-2">
          <Input
            aria-label="OpenRouter 模型 ID"
            placeholder="OpenRouter 模型 ID，例如 deepseek/deepseek-chat"
            value={openrouterDraft}
            disabled={isSaving}
            onChange={(event) => setOpenrouterDraft(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm" disabled={!openrouterDraft.trim() || isSaving}>
            使用這個模型
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
