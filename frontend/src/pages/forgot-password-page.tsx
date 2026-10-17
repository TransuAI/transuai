import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput, PasswordStrengthHint } from '@/components/password-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useSystemStatus } from '@/hooks/use-system-status'

// 忘記密碼: asks for a reset link by email. The answer is the same whether or not the email is registered (the server
// never says), so the page says "if it's registered" either way.
export function ForgotPasswordPage() {
  const status = useSystemStatus()
  const [useCode, setUseCode] = useState(false)
  if (!status) return null
  // Without mail set up there is no reset link to send: only the 復原碼.
  if (!status.mailEnabled) return <RecoveryCodeReset withoutMail />
  if (useCode) return <RecoveryCodeReset onBack={() => setUseCode(false)} />
  return <ResetByMail onUseCode={() => setUseCode(true)} />
}

function ResetByMail({ onUseCode }: { onUseCode: () => void }) {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await authApi.requestPasswordReset(email)
      setSentTo(email)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '無法送出，請稍後再試')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>忘記密碼</CardTitle>
          <CardDescription>輸入註冊的 email，我們會寄一封重設密碼的信給你</CardDescription>
        </CardHeader>
        <CardContent>
          {sentTo ? (
            <div className="flex flex-col gap-4 text-sm">
              <p role="status">
                如果 {sentTo} 有註冊、而且確認過，幾分鐘內會收到重設密碼的信，連結 30 分鐘內有效、只能用一次。沒收到的話請檢查垃圾郵件、
                用復原碼重設，或洽管理這套系統的人員。
              </p>
              <Button type="button" variant="link" className="h-auto justify-start p-0 text-sm" onClick={onUseCode}>
                用復原碼重設
              </Button>
              <Link to="/login" className="text-foreground underline underline-offset-4">
                回到登入
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
                {isSubmitting ? '送出中…' : '寄重設密碼的信'}
              </Button>
              <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={onUseCode}>
                收不到信？用復原碼重設
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="text-foreground underline underline-offset-4">
                  回到登入
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// 用復原碼重設: the email and one unused 復原碼 (made in 設定 → 帳號) set a new password without the mailbox. A wrong email
// or code gets one answer for both.
function RecoveryCodeReset({ onBack, withoutMail = false }: { onBack?: () => void; withoutMail?: boolean }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await authApi.resetPasswordWithRecoveryCode({ email, code, newPassword: password })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '無法重設密碼，請稍後再試')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>用復原碼重設密碼</CardTitle>
          <CardDescription>
            {withoutMail
              ? '這套系統沒有設定寄信，忘記密碼時用復原碼重設（設定 → 帳號產生的）；沒有復原碼請洽管理員。'
              : '輸入 email、一組還沒用過的復原碼與新密碼；所有裝置都會登出'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex flex-col gap-4 text-sm">
              <p role="status">密碼已重設，請用新密碼登入。那組復原碼不能再用了。</p>
              <Link to="/login" className="text-foreground underline underline-offset-4">
                登入
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="recovery-email">Email</Label>
                <Input id="recovery-email" type="email" required autoComplete="email" value={email}
                  onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="recovery-code">復原碼</Label>
                <Input id="recovery-code" required autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                  className="font-mono" value={code} onChange={(event) => setCode(event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="recovery-new-password">新密碼</Label>
                <PasswordInput id="recovery-new-password" required minLength={12} autoComplete="new-password"
                  aria-describedby="recovery-new-password-hint" value={password} onChange={(event) => setPassword(event.target.value)} />
                <PasswordStrengthHint id="recovery-new-password-hint" password={password} />
              </div>
              <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
                {isSubmitting ? '重設中…' : '重設密碼'}
              </Button>
{onBack && (
              <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={onBack}>
                改用 email 重設
              </Button>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
