import { useEffect, useState, type FormEvent } from 'react'
import { ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { postMeetingSettingsApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PostMeetingSettings } from '@/types/api'

// 會後處理 (see ai-service CONTEXT.md): where it may write in Notion. The agent only writes to these places; without
// them it proposes nothing for Notion. Pasted URLs are checked with Notion when saved.
export function PostMeetingSettingsSection() {
  const [settings, setSettings] = useState<PostMeetingSettings | null>(null)
  const [pageUrl, setPageUrl] = useState('')
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const show = (loaded: PostMeetingSettings) => {
    setSettings(loaded)
    setPageUrl(loaded.notionMeetingsPage?.url ?? '')
    setDatabaseUrl(loaded.notionTodoDatabase?.url ?? '')
  }

  useEffect(() => {
    postMeetingSettingsApi.get().then(show).catch(() => toast.error('無法載入會後處理的設定'))
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    try {
      show(await postMeetingSettingsApi.update(pageUrl.trim(), databaseUrl.trim()))
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
          會後處理只會把會議紀錄與待辦寫進你指定的 Notion 位置；沒指定就不會提任何 Notion 動作。貼上頁面或資料庫的網址（要先在 Notion
          分享給 TransuAI），儲存時會先確認讀得到。
        </p>
      </div>
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="notion-meetings-page" className="text-sm font-medium">
            Notion 會議紀錄頁面
          </label>
          <Input
            id="notion-meetings-page"
            placeholder="會議紀錄會建在這個頁面底下"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
          />
          {settings?.notionMeetingsPage && (
            <span className="text-xs text-muted-foreground">目前：{settings.notionMeetingsPage.title}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="notion-todo-database" className="text-sm font-medium">
            Notion 待辦資料庫
          </label>
          <Input
            id="notion-todo-database"
            placeholder="待辦會新增到這個資料庫"
            value={databaseUrl}
            onChange={(e) => setDatabaseUrl(e.target.value)}
          />
          {settings?.notionTodoDatabase && (
            <span className="text-xs text-muted-foreground">目前：{settings.notionTodoDatabase.title}</span>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="sm" className="w-fit" disabled={isSaving}>
          {isSaving ? '確認中…' : '儲存'}
        </Button>
      </form>
    </section>
  )
}
