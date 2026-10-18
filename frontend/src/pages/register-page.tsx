import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/auth-context'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput, PasswordStrengthHint } from '@/components/password-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useSystemStatus } from '@/hooks/use-system-status'

export function RegisterPage() {
  const status = useSystemStatus()
  const { register } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await register(email, password, displayName)
      void navigate('/jobs')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('這個 email 已經被註冊過了')
      } else {
        setError(err instanceof ApiError ? err.message : '註冊失敗,請稍後再試')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          {/* A fresh install: the first account becomes the administrator. */}
          <CardTitle>{status?.setupRequired ? '建立管理員帳號' : '建立帳號'}</CardTitle>
          <CardDescription>
            {status?.setupRequired
              ? '這是這套系統的第一個帳號，會成為管理員：可以在「系統設定」設定模型、語音辨識與寄信'
              : '開始上傳並產出逐字稿與摘要'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="displayName">顯示名稱</Label>
              <Input
                id="displayName"
                required
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">密碼</Label>
              <PasswordInput
                id="password"
                required
                minLength={12}
                autoComplete="new-password"
                aria-describedby="password-hint"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordStrengthHint id="password-hint" password={password} />
            </div>
            <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
              {isSubmitting ? '註冊中...' : '註冊'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              註冊即表示你已閱讀並同意{' '}
              <Link to="/privacy" className="text-foreground underline underline-offset-4">
                隱私權說明
              </Link>
              ——錄音與逐字稿會送到哪些第三方處理。
            </p>
            <p className="text-center text-sm text-muted-foreground">
              已經有帳號了?{' '}
              <Link to="/login" className="text-foreground underline underline-offset-4">
                登入
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
