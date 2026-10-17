import { useState, type ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { MIN_PASSWORD_LENGTH, PASSWORD_STRENGTH_LABELS, passwordStrength } from '@/lib/password-strength'
import { cn } from '@/lib/utils'

// A password field that can be shown while typing (ASVS 2.1.12). Paste and password managers work as usual.
export function PasswordInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className={cn('pr-9', className)} />
      <button
        type="button"
        aria-label={shown ? '隱藏密碼' : '顯示密碼'}
        aria-pressed={shown}
        aria-controls={props.id}
        onClick={() => setShown((value) => !value)}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

const STRENGTH_STEPS = { 'too-short': 0, weak: 1, fair: 2, strong: 3 } as const

// 密碼強度 under a new password (ASVS 2.1.8): a hint only; the server decides (length and its list of common passwords).
export function PasswordStrengthHint({ id, password }: { id: string; password: string }) {
  const strength = passwordStrength(password)
  const steps = STRENGTH_STEPS[strength]
  return (
    <div id={id} className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      {password && (
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {[1, 2, 3].map((step) => (
              <span
                key={step}
                className={cn('h-1 flex-1 rounded-full bg-muted', step <= steps && (steps === 1 ? 'bg-amber-500' : 'bg-primary'))}
              />
            ))}
          </div>
          <span aria-live="polite">密碼強度：{PASSWORD_STRENGTH_LABELS[strength]}</span>
        </div>
      )}
      <p>
        至少 {MIN_PASSWORD_LENGTH} 個字元，最多 128 個；可以用空格、中文或任何字元，長一點的句子最好記也最安全。太常見的密碼會被拒絕
      </p>
    </div>
  )
}
