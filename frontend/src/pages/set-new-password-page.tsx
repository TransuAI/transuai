import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/auth-context'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordInput, PasswordStrengthHint } from '@/components/password-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

// 設定新密碼: the administrator made at install (its password was generated and printed by install.sh) must replace
// that password before anything else; the gateway refuses every other call until then (.scratch/initial-admin).
export function SetNewPasswordPage() {
  const { user, changePassword, logout } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  if (user && !user.mustChangePassword) return <Navigate to="/jobs" replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    changePassword(currentPassword, newPassword)
      .then(() => navigate('/jobs', { replace: true }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setError('安裝時產生的密碼不正確')
        else setError(err instanceof ApiError ? err.message : '無法設定新密碼，請稍後再試')
      })
      .finally(() => setIsSaving(false))
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>設定新密碼</CardTitle>
          <CardDescription>
            {user?.email} 現在的密碼是安裝時產生的，請換成只有你知道的密碼，才能開始使用。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="current-password">安裝時產生的密碼</Label>
              <PasswordInput
                id="current-password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">新密碼</Label>
              <PasswordInput
                id="new-password"
                required
                minLength={12}
                autoComplete="new-password"
                aria-describedby="new-password-hint"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <PasswordStrengthHint id="new-password-hint" password={newPassword} />
            </div>
            <Button type="submit" disabled={isSaving || !currentPassword || !newPassword} className="mt-2 w-full">
              {isSaving ? '設定中…' : '設定新密碼'}
            </Button>
            <Button type="button" variant="ghost" onClick={logout}>
              登出
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
