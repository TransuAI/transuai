import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/auth-context'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useSystemStatus } from '@/hooks/use-system-status'

export function LoginPage() {
  const status = useSystemStatus()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await login(email, password)
      void navigate('/jobs')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登入失敗,請稍後再試')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登入</CardTitle>
          <CardDescription>登入以管理你的逐字稿與摘要</CardDescription>
        </CardHeader>
        <CardContent>
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
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password">密碼</Label>
                {/* Without mail set up there is only the 復原碼 way back in; the page shows just that. */}
                {status && (
                  <Link to="/forgot-password" className="text-xs text-muted-foreground underline underline-offset-4">
                    {status.mailEnabled ? '忘記密碼？' : '忘記密碼？用復原碼重設'}
                  </Link>
                )}
              </div>
              <PasswordInput
                id="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
              {isSubmitting ? '登入中...' : '登入'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              還沒有帳號?{' '}
              <Link to="/register" className="text-foreground underline underline-offset-4">
                註冊
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
