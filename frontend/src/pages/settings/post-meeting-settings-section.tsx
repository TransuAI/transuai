import { useEffect, useState, type FormEvent } from 'react'
import { ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { postMeetingSettingsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PostMeetingSettings, TodoDestination } from '@/types/api'

const DESTINATIONS: [TodoDestination, string][] = [
  ['NOTION', 'Notion 會議紀錄裡（打勾清單）'],
  ['GOOGLE_TASKS', 'Google Tasks'],
]

// 會後處理 (see ai-service CONTEXT.md): where each meeting's Notion page goes (a sub-page, with its notes and todos),
// and where todos go. A changed page link is checked with Notion when saved.
export function PostMeetingSettingsSection() {
  const [settings, setSettings] = useState<PostMeetingSettings | null>(null)
  const [pageUrl, setPageUrl] = useState('')
  const [destination, setDestination] = useState<TodoDestination>('GOOGLE_TASKS')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const show = (loaded: PostMeetingSettings) => {
    setSettings(loaded)
    setPageUrl(loaded.notionMeetingsPage?.url ?? '')
    setDestination(loaded.todoDestination)
  }

  useEffect(() => {
    postMeetingSettingsApi.get().then(show).catch(() => toast.error('無法載入會後處理的設定'))
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    try {
      show(await postMeetingSettingsApi.update({ notionMeetingsPageUrl: pageUrl.trim(), todoDestination: destination }))
      toast.success('已儲存會後處理的設定')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存失敗')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section aria-labelledby="post-meeting-settings-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="post-meeting-settings-heading" className="flex items-center gap-2 text-base font-medium">
          <ClipboardList className="size-4" />
          會後處理
        </h2>
        <p className="text-sm text-muted-foreground">
          會後處理會整理每場會議的會議紀錄和待辦，你在工作區確認之後，才會寫進 Notion 或 Google Tasks。
        </p>
      </div>
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4 rounded-lg border p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="notion-meetings-page" className="text-sm font-medium">
            Notion 會議紀錄位置
          </label>
          <span className="text-xs text-muted-foreground">
            每場會議會在這個頁面底下新增一頁，裡面有會議紀錄和待辦清單。在 Notion 打開這個頁面，按右上角「分享」→「複製連結」，貼到這裡。
          </span>
          <Input
            id="notion-meetings-page"
            placeholder="https://www.notion.so/…"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
          />
          {settings?.notionMeetingsPage && (
            <span className="text-xs text-muted-foreground">目前：{settings.notionMeetingsPage.title}</span>
          )}
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">待辦放在</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {DESTINATIONS.map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="todo-destination"
                  value={value}
                  checked={destination === value}
                  onChange={() => setDestination(value)}
                />
                {label}
              </label>
            ))}
          </div>
          {destination === 'NOTION' && !pageUrl.trim() && (
            <span className="text-xs text-muted-foreground">請先填上 Notion 會議紀錄位置，待辦會寫在每場會議那一頁裡</span>
          )}
          {destination === 'GOOGLE_TASKS' && (
            <span className="text-xs text-muted-foreground">待辦會建在你的 Google Tasks；Notion 會議紀錄裡也會列出一份清單方便閱讀</span>
          )}
        </fieldset>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="sm" className="w-fit" disabled={isSaving}>
          {isSaving ? '確認中…' : '儲存'}
        </Button>
      </form>
    </section>
  )
}
