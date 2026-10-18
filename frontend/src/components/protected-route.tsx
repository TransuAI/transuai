import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/auth-context'

export function ProtectedRoute() {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">載入中...</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Still on the password install.sh generated: nothing but 設定新密碼 until it's replaced (the gateway refuses the rest).
  if (user.mustChangePassword && location.pathname !== '/set-password') {
    return <Navigate to="/set-password" replace />
  }

  return <Outlet />
}
