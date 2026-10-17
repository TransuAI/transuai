import { Outlet } from 'react-router-dom'
import { Sidebar } from '@/components/layout/sidebar'

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />

      <main className="w-full flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
