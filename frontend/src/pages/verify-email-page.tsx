import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { takeTokenFromAddress } from '@/lib/link-token'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

// 確認 email: the page the mail's link opens. Confirming takes a click rather than happening on load, so a mail scanner
// that opens links doesn't confirm on the user's behalf.
export function VerifyEmailPage() {
  const [token] = useState(takeTokenFromAddress)
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const confirm = () => {
    if (!token) return
    setState('working')
    setError(null)
    authApi.verifyEmail(token).then(
      () => setState('done'),
      (err) => {
        setError(err instanceof ApiError ? err.message : '無法確認，請稍後再試')
        setState('idle')
      },
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>確認 email</CardTitle>
          <CardDescription>確認之後，忘記密碼時才能用 email 重設</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {state === 'done' ? (
            <>
              <p role="status">email 已確認。</p>
              <Link to="/" className="text-foreground underline underline-offset-4">回到 TransuAI</Link>
            </>
          ) : !token ? (
            <p role="alert">這個連結不完整，請從信裡的連結重新打開，或到設定頁重寄確認信。</p>
          ) : (
            <>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button onClick={confirm} disabled={state === 'working'} className="w-full">
                {state === 'working' ? '確認中…' : '確認這個 email 是我的'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
