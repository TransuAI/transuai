import { useState } from 'react'
import { DefaultModelSection } from '@/pages/settings/default-model-section'
import { ProviderKeysSection } from '@/pages/settings/provider-keys-section'

export function SettingsPage() {
  // Saving or deleting an own key changes which models can be the default.
  const [keysVersion, setKeysVersion] = useState(0)
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">設定</h1>
      <DefaultModelSection keysVersion={keysVersion} />
      <ProviderKeysSection onKeysChanged={() => setKeysVersion((version) => version + 1)} />
    </div>
  )
}
