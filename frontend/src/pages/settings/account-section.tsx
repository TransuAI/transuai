import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// 帳號: changing the password, signing out of every device (e.g. after using a shared computer or losing a phone —
// sessions elsewhere end at their next token refresh, within 15 minutes; this one ends now), and deleting the account.
export function AccountSection() {
  const { logoutEverywhere } = useAuth()
  const [isWorking, setIsWorking] = useState(false)

  const signOutEverywhere = () => {
    setIsWorking(true)
    logoutEverywhere()
      .catch((err) => toast.error(err instanceof ApiError ? err.message : '無法登出所有裝置'))
      .finally(() => setIsWorking(false))
  }

  return (
    <section aria-labelledby="account-heading" className="flex flex-col gap-3">
      <h2 id="account-heading" className="flex items-center gap-2 text-base font-medium">
        <LogOut className="size-4" />
        帳號
      </h2>
      <ChangePassword />
      <p className="text-sm text-muted-foreground">
        在別的電腦登入過、或手機遺失時，可以登出所有裝置：其他裝置最晚 15 分鐘內會被登出，這台也會登出。
      </p>
      <div>
        <Button variant="outline" disabled={isWorking} onClick={signOutEverywhere}>
          登出所有裝置
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        你的資料會送到哪些第三方處理、保存多久、你的權利：
        <Link to="/privacy" className="text-foreground underline underline-offset-4">隱私權說明</Link>
      </p>
      <DeleteAccount />
    </section>
  )
}

// 改密碼: the current password too (someone at an unlocked computer can't change it). Other devices are signed out; this
// one stays signed in. Only a wrong current password is singled out; anything else shows the server's message.
function ChangePassword() {
  const { changePassword } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    changePassword(currentPassword, newPassword)
      .then(() => {
        toast.success('密碼已更新，其他裝置要重新登入')
        setCurrentPassword('')
        setNewPassword('')
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setError('目前的密碼不正確')
        else setError(err instanceof ApiError ? err.message : '無法更新密碼，請稍後再試')
      })
      .finally(() => setIsSaving(false))
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby="change-password-heading"
      className="flex max-w-sm flex-col gap-3 rounded-md border p-4"
    >
      <h3 id="change-password-heading" className="text-sm font-medium">改密碼</h3>
      <div className="flex flex-col gap-2">
        <Label htmlFor="current-password">目前的密碼</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-password">新密碼</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          aria-describedby="new-password-hint"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <p id="new-password-hint" className="text-xs text-muted-foreground">
          至少 12 個字元，最多 128 個。改好之後，其他裝置要重新登入。
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="outline" disabled={!currentPassword || !newPassword || isSaving}>
          {isSaving ? '更新中…' : '更新密碼'}
        </Button>
      </div>
    </form>
  )
}

// 刪除帳號: permanent, so it says what goes and asks for the password again (someone at an unlocked computer can't do
// it). Only a wrong password keeps the dialog open with an error; on success the session ends and the app goes back to
// the login page.
function DeleteAccount() {
  const { deleteAccount } = useAuth()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const changeOpen = (next: boolean) => {
    if (isDeleting) return
    setOpen(next)
    setPassword('')
    setError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setIsDeleting(true)
    setError(null)
    deleteAccount(password)
      .then(() => toast.success('帳號已刪除'))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setError('密碼不正確')
        else setError(err instanceof ApiError ? err.message : '無法刪除帳號，請稍後再試')
        setIsDeleting(false)
      })
  }

  return (
    <div role="group" aria-labelledby="delete-account-heading" className="mt-4 flex flex-col gap-2 rounded-md border border-destructive/40 p-4">
      <h3 id="delete-account-heading" className="text-sm font-medium text-destructive">刪除帳號</h3>
      <p className="text-sm text-muted-foreground">
        永久刪除你的帳號與所有資料，無法復原。
      </p>
      <div>
        <Button variant="destructive" onClick={() => changeOpen(true)}>
          刪除帳號…
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={changeOpen}>
        <AlertDialogContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>刪除帳號？</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="flex flex-col gap-2">
                  <p>以下會永久刪除，無法復原：</p>
                  <ul className="list-disc pl-5">
                    <li>所有 Job 與上傳的錄音、影片</li>
                    <li>逐字稿、講者，以及 AI 產生的摘要、章節、問答、測驗、會後處理紀錄</li>
                    <li>筆記</li>
                    <li>自有金鑰、預設模型與其他設定</li>
                    <li>已連結的 Google、Notion 帳號（會向對方撤銷授權）</li>
                  </ul>
                  <p>用量統計會留下，但不再對應到你。之後可以用同一個 email 重新註冊，但會是全新的帳號。</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="delete-account-password">輸入密碼確認</Label>
              <Input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={error !== null}
                aria-describedby={error ? 'delete-account-error' : undefined}
              />
              {error && (
                <p id="delete-account-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={isDeleting}>取消</AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={!password || isDeleting}>
                {isDeleting ? '刪除中…' : '永久刪除帳號'}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
