import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput, PasswordStrengthHint } from '@/components/password-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

// The token comes after # in the link (never sent to a server, not in logs or Referer). It is read once and taken out of
// the address bar, so it doesn't stay in the history either.
function takeTokenFromAddress(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
  if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return token
}

// 重設密碼: the page the mail's link opens. Sets a new password with the one-use token; every device is signed out,
// so it then asks to sign in with the new password.
export function ResetPasswordPage() {
  const [token] = useState(takeTokenFromAddress)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<{ message: string; linkExpired: boolean } | null>(null)
  const [done, setDone] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    setError(null)
    setIsSubmitting(true)
    try {
      await authApi.resetPassword({ token, newPassword: password })
      setDone(true)
    } catch (err) {
      if (err instanceof ApiError) setError({ message: err.message, linkExpired: err.status === 409 })
      else setError({ message: '無法重設密碼，請稍後再試', linkExpired: false })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>重設密碼</CardTitle>
          <CardDescription>設一個新的密碼；所有裝置都會登出</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex flex-col gap-4 text-sm">
              <p role="status">密碼已重設，請用新密碼登入。</p>
              <Link to="/login" className="text-foreground underline underline-offset-4">
                登入
              </Link>
            </div>
          ) : !token ? (
            <div className="flex flex-col gap-4 text-sm">
              <p role="alert">這個連結不完整，請從信裡的連結重新打開，或重新申請。</p>
              <Link to="/forgot-password" className="text-foreground underline underline-offset-4">
                重新申請重設密碼
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {error.message}
                    {error.linkExpired && (
                      <>
                        {' '}
                        <Link to="/forgot-password" className="underline underline-offset-4">
                          重新申請
                        </Link>
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">新密碼</Label>
                <PasswordInput
                  id="new-password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  aria-describedby="new-password-hint"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <PasswordStrengthHint id="new-password-hint" password={password} />
              </div>
              <Button type="submit" disabled={isSubmitting || !password} className="mt-2 w-full">
                {isSubmitting ? '重設中…' : '重設密碼'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
