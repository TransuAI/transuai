import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { AudioLines, Cpu, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { forgetSystemStatus } from '@/hooks/use-system-status'
import { adminSettingsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AiSettings, MailSettings, SpeechSettings } from '@/types/api'

// 系統設定 (.scratch/system-settings/spec.md): the whole installation's models, speech recognition and mail. Administrators
// only (the server refuses everyone else too). Each section saves on its own and takes effect at once; one never saved
// uses the deployment's environment variables, and can go back to them.
export function SystemSettingsPage() {
  const { user } = useAuth()
  if (user && !user.admin) return <Navigate to="/settings" replace />
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">系統設定</h1>
        <p className="text-sm text-muted-foreground">
          套用到這套系統的所有人，存了馬上生效。沒有在這裡存過的，用部署時的環境變數。金鑰與密碼存了之後不會再顯示。
        </p>
      </div>
      <AiSection />
      <SpeechSection />
      <MailSection />
    </div>
  )
}

/** A key or password field: never shows what's saved. Left empty keeps it; 清除 removes it. */
interface SecretState {
  value: string
  clear: boolean
}

const UNTOUCHED: SecretState = { value: '', clear: false }

/** What an update sends for a secret: undefined keeps it, '' clears it, anything else replaces it. */
function secretUpdate(state: SecretState): string | undefined {
  if (state.clear) return ''
  return state.value ? state.value : undefined
}

function SecretField({ label, isSet, state, onChange }: {
  label: string
  isSet: boolean
  state: SecretState
  onChange: (state: SecretState) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          // Not a password of this site: keep password managers out of it.
          autoComplete="new-password"
          placeholder={state.clear ? '儲存後會清除' : isSet ? '已設定（留空表示不改）' : '未設定'}
          value={state.value}
          disabled={state.clear}
          onChange={(event) => onChange({ value: event.target.value, clear: false })}
          className="min-w-0 flex-1"
        />
        {isSet && (
          <Button type="button" variant="outline" size="sm" className="h-9"
                  onClick={() => onChange(state.clear ? UNTOUCHED : { value: '', clear: true })}>
            {state.clear ? '不清除' : '清除'}
          </Button>
        )}
      </div>
    </div>
  )
}

function TextField({ label, value, onChange, placeholder, hint, type = 'text' }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  type?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SettingsSection({ id, icon, title, description, fromEnvironment, children }: {
  id: string
  icon: ReactNode
  title: string
  description: string
  fromEnvironment: boolean | null
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="flex items-center gap-2 text-base font-medium">
          {icon}
          {title}
          {fromEnvironment !== null && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              {fromEnvironment ? '目前用環境變數' : '用這裡存的設定'}
            </span>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

/** Save, back to the environment, and a check — the same row in every section. */
function Actions({ saving, fromEnvironment, onUseEnvironment, check }: {
  saving: boolean
  fromEnvironment: boolean
  onUseEnvironment: () => void
  check?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? '儲存中…' : '儲存'}
      </Button>
      {check}
      {!fromEnvironment && (
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onUseEnvironment}>
          改回環境變數
        </Button>
      )}
    </div>
  )
}

function CheckResult({ lines }: { lines: { ok: boolean; text: string }[] | null }) {
  if (!lines) return null
  return (
    <ul aria-label="測試結果" className="flex flex-col gap-1 text-sm">
      {lines.map((line, i) => (
        <li key={i} className={line.ok ? 'text-foreground' : 'text-destructive'}>
          {line.ok ? '✓ ' : '✗ '}
          {line.text}
        </li>
      ))}
    </ul>
  )
}

function failure(err: unknown, fallback: string) {
  toast.error(err instanceof ApiError ? err.message : fallback)
}

// --- AI 模型 ---

function AiSection() {
  const [saved, setSaved] = useState<AiSettings | null>(null)
  const [form, setForm] = useState({
    platformBaseUrl: '', platformModel: '', postMeetingModel: '', embeddingBaseUrl: '', embeddingModel: '',
    embeddingQueryInstruction: '',
  })
  const [platformKey, setPlatformKey] = useState(UNTOUCHED)
  const [embeddingKey, setEmbeddingKey] = useState(UNTOUCHED)
  const [webSearchKey, setWebSearchKey] = useState(UNTOUCHED)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; text: string }[] | null>(null)

  const show = (settings: AiSettings) => {
    setSaved(settings)
    setForm({
      platformBaseUrl: settings.platformBaseUrl, platformModel: settings.platformModel,
      postMeetingModel: settings.postMeetingModel, embeddingBaseUrl: settings.embeddingBaseUrl,
      embeddingModel: settings.embeddingModel, embeddingQueryInstruction: settings.embeddingQueryInstruction,
    })
    setPlatformKey(UNTOUCHED)
    setEmbeddingKey(UNTOUCHED)
    setWebSearchKey(UNTOUCHED)
  }
  useEffect(() => {
    adminSettingsApi.ai().then(show, (err) => failure(err, '無法讀取模型設定'))
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      show(await adminSettingsApi.updateAi({
        ...form, platformApiKey: secretUpdate(platformKey), embeddingApiKey: secretUpdate(embeddingKey),
        webSearchApiKey: secretUpdate(webSearchKey),
      }))
      setCheck(null)
      toast.success('模型設定已儲存')
    } catch (err) {
      failure(err, '儲存失敗')
    } finally {
      setSaving(false)
    }
  }
  const revertToEnvironment = async () => {
    setSaving(true)
    try {
      show(await adminSettingsApi.updateAi({ ...form, useEnvironment: true }))
      toast.success('已改回環境變數')
    } catch (err) {
      failure(err, '儲存失敗')
    } finally {
      setSaving(false)
    }
  }
  const runCheck = async () => {
    setChecking(true)
    try {
      const result = await adminSettingsApi.checkAi()
      setCheck([
        { ok: result.platformOk, text: `平台模型：${result.platformDetail}` },
        { ok: result.embeddingOk, text: `Embedding：${result.embeddingDetail}` },
      ])
    } catch (err) {
      failure(err, '無法測試')
    } finally {
      setChecking(false)
    }
  }

  const set = (field: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [field]: value }))
  return (
    <SettingsSection id="ai-settings-heading" icon={<Cpu className="size-4" />} title="AI 模型"
      description="平台模型負責摘要、章節、問答等所有 AI 功能（使用者也可以用自己的金鑰改用別的模型）；embedding 用來在問答時找相關段落。都是 OpenAI 相容的伺服器，例如自架的 vLLM。"
      fromEnvironment={saved?.fromEnvironment ?? null}>
      {saved && (
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="平台模型的伺服器" value={form.platformBaseUrl} onChange={set('platformBaseUrl')}
                       placeholder="http://gpu-server:8000/v1" /* NOSONAR: an example of an on-prem model server, which serves plain http inside the network */ />
            <TextField label="平台模型" value={form.platformModel} onChange={set('platformModel')} placeholder="Qwen/Qwen3-8B-AWQ" />
            <SecretField label="平台模型的金鑰（沒有就留空）" isSet={saved.platformApiKeySet} state={platformKey} onChange={setPlatformKey} />
            <TextField label="會後處理的模型" value={form.postMeetingModel} onChange={set('postMeetingModel')}
                       hint="同一台伺服器上、能呼叫工具的模型；留空就不提供會後處理" />
            <TextField label="Embedding 的伺服器" value={form.embeddingBaseUrl} onChange={set('embeddingBaseUrl')}
                       placeholder="http://gpu-server:8001/v1" /* NOSONAR: an example of an on-prem model server, which serves plain http inside the network */ hint="留空：問答只根據摘要與章節回答" />
            <TextField label="Embedding 模型" value={form.embeddingModel} onChange={set('embeddingModel')}
                       placeholder="Qwen/Qwen3-Embedding-0.6B" hint="要輸出 1024 維；換了之後既有的向量會在背景重算" />
            <SecretField label="Embedding 的金鑰（沒有就留空）" isSet={saved.embeddingApiKeySet} state={embeddingKey} onChange={setEmbeddingKey} />
            <TextField label="問題前面加的指示" value={form.embeddingQueryInstruction} onChange={set('embeddingQueryInstruction')}
                       hint="Qwen3-Embedding 這類模型用；bge-m3 留空" />
          </div>
          <SecretField label="網路搜尋（Tavily）的金鑰" isSet={saved.webSearchApiKeySet} state={webSearchKey} onChange={setWebSearchKey} />
          <Actions saving={saving} fromEnvironment={saved.fromEnvironment} onUseEnvironment={() => void revertToEnvironment()}
            check={
              <Button type="button" size="sm" variant="outline" disabled={checking || saving} onClick={() => void runCheck()}>
                {checking ? '測試中…' : '測試連線'}
              </Button>
            } />
          <CheckResult lines={check} />
        </form>
      )}
    </SettingsSection>
  )
}

// --- 語音辨識 ---

const ACTIVE_LABEL: Record<SpeechSettings['active'], string> = {
  local: '目前用：本地語音辨識',
  deepgram: '目前用：Deepgram（雲端）',
  none: '目前沒有設定語音辨識，上傳的檔案無法轉錄',
}

function SpeechSection() {
  const [saved, setSaved] = useState<SpeechSettings | null>(null)
  const [form, setForm] = useState({ sttBaseUrl: '', sttModel: '', diarizationThreshold: '0.6' })
  const [sttKey, setSttKey] = useState(UNTOUCHED)
  const [deepgramKey, setDeepgramKey] = useState(UNTOUCHED)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; text: string }[] | null>(null)

  const show = (settings: SpeechSettings) => {
    setSaved(settings)
    setForm({ sttBaseUrl: settings.sttBaseUrl, sttModel: settings.sttModel,
              diarizationThreshold: String(settings.diarizationThreshold) })
    setSttKey(UNTOUCHED)
    setDeepgramKey(UNTOUCHED)
  }
  useEffect(() => {
    adminSettingsApi.speech().then(show, (err) => failure(err, '無法讀取語音辨識設定'))
  }, [])

  const update = (useEnvironment = false) => ({
    sttBaseUrl: form.sttBaseUrl, sttModel: form.sttModel, diarizationThreshold: Number(form.diarizationThreshold),
    sttApiKey: secretUpdate(sttKey), deepgramApiKey: secretUpdate(deepgramKey), useEnvironment,
  })
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      show(await adminSettingsApi.updateSpeech(update()))
      setCheck(null)
      toast.success('語音辨識設定已儲存')
    } catch (err) {
      failure(err, '儲存失敗')
    } finally {
      setSaving(false)
    }
  }
  const revertToEnvironment = async () => {
    setSaving(true)
    try {
      show(await adminSettingsApi.updateSpeech(update(true)))
      toast.success('已改回環境變數')
    } catch (err) {
      failure(err, '儲存失敗')
    } finally {
      setSaving(false)
    }
  }
  const runCheck = async () => {
    setChecking(true)
    try {
      const result = await adminSettingsApi.checkSpeech()
      setCheck([{ ok: result.ok, text: result.detail }])
    } catch (err) {
      failure(err, '無法測試')
    } finally {
      setChecking(false)
    }
  }

  const set = (field: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [field]: value }))
  return (
    <SettingsSection id="speech-settings-heading" icon={<AudioLines className="size-4" />} title="語音辨識"
      description="上傳的錄音怎麼轉成逐字稿。有填本地伺服器就用它（自架 vLLM 的 Breeze-ASR-25，講者分離在系統內用 CPU 跑，錄音不會離開內部網路）；沒有才用 Deepgram（雲端）。"
      fromEnvironment={saved?.fromEnvironment ?? null}>
      {saved && (
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4 rounded-lg border p-4">
          <p className="text-sm font-medium">{ACTIVE_LABEL[saved.active]}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="本地語音辨識的伺服器" value={form.sttBaseUrl} onChange={set('sttBaseUrl')}
                       placeholder="http://gpu-server:8002/v1" /* NOSONAR: an example of an on-prem model server, which serves plain http inside the network */ />
            <TextField label="語音辨識模型" value={form.sttModel} onChange={set('sttModel')} placeholder="MediaTek-Research/Breeze-ASR-25" />
            <SecretField label="本地伺服器的金鑰（沒有就留空）" isSet={saved.sttApiKeySet} state={sttKey} onChange={setSttKey} />
            <TextField label="講者分離的門檻" type="number" value={form.diarizationThreshold} onChange={set('diarizationThreshold')}
              hint={saved.diarizationAvailable
                ? '越大分出越少人（預設 0.6）'
                : '這個部署沒有講者分離的模型：本地辨識時不分講者'} />
          </div>
          <SecretField label="Deepgram 的金鑰（不用本地伺服器時）" isSet={saved.deepgramApiKeySet} state={deepgramKey} onChange={setDeepgramKey} />
          <Actions saving={saving} fromEnvironment={saved.fromEnvironment} onUseEnvironment={() => void revertToEnvironment()}
            check={
              <Button type="button" size="sm" variant="outline" disabled={checking || saving} onClick={() => void runCheck()}>
                {checking ? '測試中…' : '測試連線'}
              </Button>
            } />
          <CheckResult lines={check} />
        </form>
      )}
    </SettingsSection>
  )
}

// --- 寄信 ---

function MailSection() {
  const [saved, setSaved] = useState<MailSettings | null>(null)
  const [form, setForm] = useState({ host: '', port: '587', username: '', from: '', starttls: true, smtpAuth: true })
  const [password, setPassword] = useState(UNTOUCHED)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string }[] | null>(null)

  const show = (settings: MailSettings) => {
    setSaved(settings)
    setForm({ host: settings.host, port: String(settings.port || 587), username: settings.username, from: settings.from,
              starttls: settings.starttls, smtpAuth: settings.smtpAuth })
    setPassword(UNTOUCHED)
    // Login, 忘記密碼 and email confirmation read whether mail is on: ask again on the next page.
    forgetSystemStatus()
  }
  useEffect(() => {
    adminSettingsApi.mail().then(show, (err) => failure(err, '無法讀取寄信設定'))
  }, [])

  const update = (useEnvironment = false) => ({
    host: form.host, port: Number(form.port) || 587, username: form.username, from: form.from, starttls: form.starttls,
    smtpAuth: form.smtpAuth, password: password.clear ? undefined : password.value || undefined,
    clearPassword: password.clear, useEnvironment,
  })
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      show(await adminSettingsApi.updateMail(update()))
      setTest(null)
      toast.success('寄信設定已儲存')
    } catch (err) {
      failure(err, '儲存失敗')
    } finally {
      setSaving(false)
    }
  }
  const revertToEnvironment = async () => {
    setSaving(true)
    try {
      show(await adminSettingsApi.updateMail(update(true)))
      toast.success('已改回環境變數')
    } catch (err) {
      failure(err, '儲存失敗')
    } finally {
      setSaving(false)
    }
  }
  const sendTest = async () => {
    setTesting(true)
    try {
      const result = await adminSettingsApi.testMail()
      setTest([{ ok: result.sent, text: result.sent ? '已寄出測試信到你的 email' : `寄不出去：${result.error}` }])
    } catch (err) {
      failure(err, '無法寄測試信')
    } finally {
      setTesting(false)
    }
  }

  const set = (field: 'host' | 'port' | 'username' | 'from') => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }))
  return (
    <SettingsSection id="mail-settings-heading" icon={<Mail className="size-4" />} title="寄信"
      description="忘記密碼的重設信、註冊時的 email 確認與帳號異動通知都靠它。沒有設定時，這些功能不會出現：使用者忘記密碼時用復原碼重設。"
      fromEnvironment={saved?.fromEnvironment ?? null}>
      {saved && (
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4 rounded-lg border p-4">
          <p className="text-sm font-medium">{saved.enabled ? '目前可以寄信' : '目前沒有設定寄信'}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="SMTP 主機" value={form.host} onChange={set('host')} placeholder="smtp.example.com" />
            <TextField label="埠" type="number" value={form.port} onChange={set('port')} />
            <TextField label="帳號" value={form.username} onChange={set('username')} />
            <SecretField label="密碼" isSet={saved.passwordSet} state={password} onChange={setPassword} />
            <TextField label="寄件人" value={form.from} onChange={set('from')} placeholder="TransuAI <no-reply@example.com>" />
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={form.starttls} onCheckedChange={(on) => setForm((prev) => ({ ...prev, starttls: on }))} />
              STARTTLS
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={form.smtpAuth} onCheckedChange={(on) => setForm((prev) => ({ ...prev, smtpAuth: on }))} />
              需要登入
            </label>
          </div>
          <Actions saving={saving} fromEnvironment={saved.fromEnvironment} onUseEnvironment={() => void revertToEnvironment()}
            check={
              <Button type="button" size="sm" variant="outline" disabled={testing || saving || !saved.enabled}
                      onClick={() => void sendTest()}>
                {testing ? '寄送中…' : '寄測試信給自己'}
              </Button>
            } />
          <CheckResult lines={test} />
        </form>
      )}
    </SettingsSection>
  )
}
