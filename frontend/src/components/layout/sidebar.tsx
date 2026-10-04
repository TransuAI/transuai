import { useState, type ComponentType } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AudioLines, Folder, Gavel, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/auth-context'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { DarkModeToggle } from '@/components/layout/dark-mode-toggle'

const JOB_DETAIL_ROUTE_PATTERN = /^\/jobs\/[^/]+$/

const NAV_ITEMS: { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean }[] = [
  { to: '/jobs', label: '我的 Job', icon: Folder, end: true },
  { to: '/decisions', label: '決策', icon: Gavel },
  { to: '/upload', label: '上傳', icon: Upload },
  { to: '/settings', label: '設定', icon: Settings },
]

function initials(name: string | null, email: string) {
  const source = name?.trim() || email
  return source.slice(0, 2).toUpperCase()
}

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <NavLink
      to="/"
      aria-label={collapsed ? 'TransuAI' : undefined}
      className={cn('flex items-center gap-2 px-3 py-4 font-semibold', collapsed && 'justify-center px-0')}
    >
      <AudioLines className="size-5 shrink-0" />
      {!collapsed && <span>TransuAI</span>}
    </NavLink>
  )
}

function SidebarNavItems({ collapsed }: { collapsed: boolean }) {
  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => {
        const link = (
          <NavLink
            to={to}
            end={end}
            aria-label={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                collapsed && 'justify-center px-0',
                isActive && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
              )
            }
          >
            <Icon className="size-5 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        )

        if (!collapsed) {
          return <div key={to}>{link}</div>
        }

        return (
          <Tooltip key={to}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </nav>
  )
}

function SidebarUserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const trigger = (
    <Button
      variant="ghost"
      className={cn('flex h-auto w-full items-center gap-2 px-2 py-2', collapsed && 'justify-center px-0')}
    >
      <Avatar className="size-8">
        <AvatarFallback>{initials(user.displayName, user.email)}</AvatarFallback>
      </Avatar>
      {!collapsed && (
        <span className="flex flex-col items-start overflow-hidden text-left">
          <span className="w-full truncate text-sm font-medium">{user.displayName || user.email}</span>
          <span className="w-full truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
      )}
    </Button>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{user.displayName || user.email}</span>
            <span className="text-xs text-muted-foreground">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="size-4" />
          登出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarBody({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean
  onToggleCollapsed?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <SidebarBrand collapsed={collapsed} />
      <div className="flex-1 overflow-y-auto py-2">
        <SidebarNavItems collapsed={collapsed} />
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t p-2">
        <SidebarUserMenu collapsed={collapsed} />
        <DarkModeToggle collapsed={collapsed} />
        {onToggleCollapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="w-full"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? '展開側邊欄' : '收合側邊欄'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        )}
      </div>
    </div>
  )
}

export function Sidebar() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const routeDefaultCollapsed = JOB_DETAIL_ROUTE_PATTERN.test(location.pathname)
  const [override, setOverride] = useState<boolean | null>(null)
  const [lastPathname, setLastPathname] = useState(location.pathname)

  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname)
    setOverride(null)
  }

  const collapsed = override ?? routeDefaultCollapsed
  const toggleCollapsed = () => setOverride(!collapsed)

  return (
    <TooltipProvider>
      <div
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 border-r bg-sidebar text-sidebar-foreground transition-[width] duration-150 md:block',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <SidebarBody collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </div>

      <div className="flex items-center justify-between border-b bg-sidebar p-2 text-sidebar-foreground md:hidden">
        <SidebarBrand collapsed={false} />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="開啟導覽選單">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">導覽選單</SheetTitle>
            <SidebarBody collapsed={false} />
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  )
}
