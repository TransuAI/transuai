import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { authApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { downloadTextFile } from '@/lib/download'
import type { User } from '@/types/api'
import { Button } from '@/components/ui/button'
import { PasswordInput, PasswordStrengthHint } from '@/components/password-input'
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
// sessions elsewhere end at their next request), and deleting the account.
export function AccountSection() {
  const { logoutEverywhere } = useAuth()
  const [user, setUser] = useCurrentUser()
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
      {user && <EmailStatus user={user} />}
      <ChangePassword />
      {user && <RecoveryCodes user={user} onChange={setUser} />}
      <p className="text-sm text-muted-foreground">
        在別的電腦登入過、或手機遺失時，可以登出所有裝置：其他裝置馬上會被登出，這台也會登出。
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

// The signed-in user as the server has it now (whether the email is confirmed, how many 復原碼 are left), loaded here
// because they change outside this page (the confirmation link, a code used at the login page).
function useCurrentUser(): [User | null, (user: User) => void] {
  const [user, setUser] = useState<User | null>(null)
  useEffect(() => {
    let cancelled = false
    authApi.me().then((me) => !cancelled && setUser(me), () => {})
    return () => {
      cancelled = true
    }
  }, [])
  return [user, setUser]
}

// 確認 email: 忘記密碼 mails only a confirmed address, so an unconfirmed one says so and offers the link again.
function EmailStatus({ user }: { user: User }) {
  const [isSending, setIsSending] = useState(false)

  const resend = () => {
    setIsSending(true)
    authApi
      .resendEmailVerification()
      .then(
        () => toast.success(`已寄確認信到 ${user.email}`),
        (err) => toast.error(err instanceof ApiError ? err.message : '無法寄確認信，請稍後再試'),
      )
      .finally(() => setIsSending(false))
  }

  return (
    <div role="group" aria-label="Email" className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Email：</span>
      <span>{user.email}</span>
      {user.emailVerified ? (
        <span className="text-muted-foreground">（已確認）</span>
      ) : (
        <>
          <span className="text-muted-foreground">（還沒確認：忘記密碼時收不到重設的信）</span>
          <Button size="sm" variant="outline" disabled={isSending} onClick={resend}>
            重寄確認信
          </Button>
        </>
      )}
    </div>
  )
}

// 復原碼: made with the current password; shown once (copy or download them then); making new ones ends the old. They
// reset the password from the login page without the mailbox.
function RecoveryCodes({ user, onChange }: { user: User; onChange: (user: User) => void }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  const changeOpen = (next: boolean) => {
    if (isWorking) return
    setOpen(next)
    setPassword('')
    setError(null)
    setCodes(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setIsWorking(true)
    setError(null)
    authApi
      .generateRecoveryCodes(password)
      .then((made) => {
        setCodes(made.codes)
        onChange({ ...user, recoveryCodesLeft: made.codes.length })
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setError('密碼不正確')
        else setError(err instanceof ApiError ? err.message : '無法產生復原碼，請稍後再試')
      })
      .finally(() => setIsWorking(false))
  }

  const asText = (list: string[]) => `TransuAI 復原碼（${user.email}）\n每組只能用一次。\n\n${list.join('\n')}\n`

  return (
    <div role="group" aria-labelledby="recovery-codes-heading" className="flex max-w-sm flex-col gap-2 rounded-md border p-4">
      <h3 id="recovery-codes-heading" className="text-sm font-medium">復原碼</h3>
      <p className="text-sm text-muted-foreground">
        忘記密碼又收不到信時，可以在登入頁用 email 加一組復原碼重設密碼。
        {user.recoveryCodesLeft > 0 ? `還有 ${user.recoveryCodesLeft} 組沒用過。` : '還沒有復原碼。'}
      </p>
      <div>
        <Button variant="outline" onClick={() => changeOpen(true)}>
          {user.recoveryCodesLeft > 0 ? '產生新的復原碼…' : '產生復原碼…'}
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={changeOpen}>
        <AlertDialogContent>
          {codes ? (
            <div className="flex flex-col gap-4">
              <AlertDialogHeader>
                <AlertDialogTitle>你的復原碼</AlertDialogTitle>
                <AlertDialogDescription>
                  只會顯示這一次：請複製或下載，存在安全的地方。每組只能用一次，之前的復原碼都不能用了。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <ul aria-label="復原碼" className="grid grid-cols-1 gap-1 font-mono text-sm sm:grid-cols-2">
                {codes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    navigator.clipboard.writeText(asText(codes)).then(
                      () => toast.success('已複製復原碼'),
                      () => toast.error('複製失敗'),
                    )
                  }
                >
                  複製
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadTextFile({ fileName: 'transuai-復原碼.txt', content: asText(codes), mimeType: 'text/plain' })
                  }
                >
                  下載
                </Button>
              </div>
              <AlertDialogFooter>
                <Button onClick={() => changeOpen(false)}>我存好了</Button>
              </AlertDialogFooter>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <AlertDialogHeader>
                <AlertDialogTitle>產生復原碼</AlertDialogTitle>
                <AlertDialogDescription>會產生 10 組新的復原碼，之前的都不能用了。請輸入目前的密碼確認。</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="recovery-codes-password">目前的密碼</Label>
                <PasswordInput
                  id="recovery-codes-password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={error !== null}
                  aria-describedby={error ? 'recovery-codes-error' : undefined}
                />
                {error && (
                  <p id="recovery-codes-error" role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={isWorking}>取消</AlertDialogCancel>
                <Button type="submit" disabled={!password || isWorking}>
                  {isWorking ? '產生中…' : '產生'}
                </Button>
              </AlertDialogFooter>
            </form>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
        <PasswordInput
          id="current-password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-password">新密碼</Label>
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          minLength={12}
          aria-describedby="new-password-hint"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <PasswordStrengthHint id="new-password-hint" password={newPassword} />
        <p className="text-xs text-muted-foreground">改好之後，其他裝置要重新登入。</p>
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
              <PasswordInput
                id="delete-account-password"
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
