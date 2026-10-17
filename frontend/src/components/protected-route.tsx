import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/auth-context'

export function ProtectedRoute() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">載入中...</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
