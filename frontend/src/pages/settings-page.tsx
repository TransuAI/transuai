import { useState } from 'react'
import { AccountSection } from '@/pages/settings/account-section'
import { ConnectedAccountsSection } from '@/pages/settings/connected-accounts-section'
import { DefaultModelSection } from '@/pages/settings/default-model-section'
import { MonthlyUsageSection } from '@/pages/settings/monthly-usage-section'
import { PostMeetingSettingsSection } from '@/pages/settings/post-meeting-settings-section'
import { ProviderKeysSection } from '@/pages/settings/provider-keys-section'

// What most people come here for first (how much is left this month, what's connected), then the AI model and own keys
// for those who want them, and the account last — deleting it is at the very bottom.
const SECTIONS = [
  { id: 'monthly-usage-heading', label: '本月用量' },
  { id: 'connected-accounts-heading', label: '已連結的帳號' },
  { id: 'post-meeting-settings-heading', label: '會後處理' },
  { id: 'default-model-heading', label: 'AI 模型' },
  { id: 'provider-keys-heading', label: '自有金鑰' },
  { id: 'account-heading', label: '帳號' },
]

export function SettingsPage() {
  // Saving or deleting an own key changes which models can be the default.
  const [keysVersion, setKeysVersion] = useState(0)
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">設定</h1>
        <nav aria-label="設定的各區" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {SECTIONS.map(({ id, label }) => (
            <a key={id} href={`#${id}`} className="underline-offset-4 hover:text-foreground hover:underline">
              {label}
            </a>
          ))}
        </nav>
      </div>
      <MonthlyUsageSection />
      <ConnectedAccountsSection />
      <PostMeetingSettingsSection />
      <DefaultModelSection keysVersion={keysVersion} />
      <ProviderKeysSection onKeysChanged={() => setKeysVersion((version) => version + 1)} />
      <AccountSection />
    </div>
  )
}
