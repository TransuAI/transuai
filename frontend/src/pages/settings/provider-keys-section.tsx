import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { providerKeysApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import type { ProviderKey } from '@/types/api'

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'openrouter', name: 'OpenRouter' },
] as const

type Provider = (typeof PROVIDERS)[number]

// 自有金鑰 (see ai-service CONTEXT.md): one key per provider. A saved key is never shown again, only its
// last four characters; typing a new one replaces it.
export function ProviderKeysSection() {
  const [keys, setKeys] = useState<ProviderKey[]>([])
  const [deleting, setDeleting] = useState<Provider | null>(null)

  useEffect(() => {
    providerKeysApi.list().then(setKeys).catch(() => toast.error('無法載入自有金鑰'))
  }, [])

  const keyOf = (provider: Provider) => keys.find((key) => key.provider === provider.id) ?? null
  const replace = (provider: Provider, key: ProviderKey | null) =>
    setKeys((prev) => [...prev.filter((k) => k.provider !== provider.id), ...(key ? [key] : [])])

  const confirmDelete = async () => {
    if (!deleting) return
    const provider = deleting
    try {
      await providerKeysApi.remove(provider.id)
      replace(provider, null)
    } catch {
      toast.error('刪除失敗')
    }
  }

  return (
    <section aria-labelledby="provider-keys-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="provider-keys-heading" className="flex items-center gap-2 text-base font-medium">
          <KeyRound className="size-4" />
          自有金鑰
        </h2>
        <p className="text-sm text-muted-foreground">
          存入自己的 AI 廠商金鑰，之後就能改用這些廠商的模型，費用由你的帳號負擔。金鑰存入前會先向廠商確認有效，存入後只顯示末四碼。
        </p>
      </div>
      <div className="flex flex-col divide-y rounded-lg border">
        {PROVIDERS.map((provider) => (
          <ProviderKeyRow
            key={provider.id}
            provider={provider}
            saved={keyOf(provider)}
            onSaved={(key) => replace(provider, key)}
            onDelete={() => setDeleting(provider)}
          />
        ))}
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除 {deleting?.name} 的金鑰？</AlertDialogTitle>
            <AlertDialogDescription>平台會刪除這把金鑰，之後就不會再用它呼叫 {deleting?.name}。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>刪除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function ProviderKeyRow({
  provider,
  saved,
  onSaved,
  onDelete,
}: {
  provider: Provider
  saved: ProviderKey | null
  onSaved: (key: ProviderKey) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim() || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      onSaved(await providerKeysApi.save(provider.id, draft.trim()))
      setDraft('')
    } catch (err) {
      // Keep what the user typed so a typo can be fixed in place.
      setError(err instanceof ApiError ? err.message : '儲存失敗')
    } finally {
      setIsSaving(false)
    }
  }

  const inputId = `provider-key-${provider.id}`
  return (
    <div role="group" aria-label={provider.name} className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          {provider.name}
        </label>
        <span className="font-mono text-xs text-muted-foreground">{saved ? `…${saved.last4}` : '未設定'}</span>
      </div>
      <form onSubmit={(event) => void save(event)} className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          aria-label={`${provider.name} 金鑰`}
          type="password"
          // Not a password of this site: keep password managers from offering to save it.
          autoComplete="new-password"
          placeholder={saved ? '輸入新的金鑰以替換' : '貼上金鑰'}
          value={draft}
          disabled={isSaving}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" disabled={!draft.trim() || isSaving}>
          {isSaving ? '驗證中…' : saved ? '替換' : '儲存'}
        </Button>
        {saved && (
          <Button type="button" size="sm" variant="outline" onClick={onDelete}>
            刪除
          </Button>
        )}
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
