import { ProviderKeysSection } from '@/pages/settings/provider-keys-section'

export function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">設定</h1>
      <ProviderKeysSection />
    </div>
  )
}
