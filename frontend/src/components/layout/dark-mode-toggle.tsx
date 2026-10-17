import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'

export function DarkModeToggle({ collapsed }: { collapsed: boolean }) {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <div className={cn('flex items-center gap-2 px-2 py-1.5', collapsed ? 'justify-center' : 'justify-between')}>
      {!collapsed && (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
          深色模式
        </span>
      )}
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
        aria-label="切換深色模式"
      />
    </div>
  )
}
