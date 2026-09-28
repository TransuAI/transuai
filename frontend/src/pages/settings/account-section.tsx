import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

// 帳號: signing out of every device, e.g. after using a shared computer or losing a phone. Sessions elsewhere end at
// their next token refresh (within 15 minutes); this one ends now.
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
      <p className="text-sm text-muted-foreground">
        在別的電腦登入過、或手機遺失時，可以登出所有裝置：其他裝置最晚 15 分鐘內會被登出，這台也會登出。
      </p>
      <div>
        <Button variant="outline" disabled={isWorking} onClick={signOutEverywhere}>
          登出所有裝置
        </Button>
      </div>
    </section>
  )
}
