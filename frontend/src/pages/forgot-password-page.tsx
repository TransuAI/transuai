import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

// 忘記密碼: asks for a reset link by email. The answer is the same whether or not the email is registered (the server
// never says), so the page says "if it's registered" either way.
export function ForgotPasswordPage() {
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
                如果 {sentTo} 有註冊，幾分鐘內會收到重設密碼的信，連結 30 分鐘內有效、只能用一次。沒收到的話請檢查垃圾郵件，或洽管理這套系統的人員。
              </p>
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
