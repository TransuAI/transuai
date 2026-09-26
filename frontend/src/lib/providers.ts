// The AI providers a user can bring their own key for (自有金鑰), as ai-service supports them.
export const PROVIDERS = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'openrouter', name: 'OpenRouter' },
] as const

export type Provider = (typeof PROVIDERS)[number]

export function providerName(id: string): string {
  return PROVIDERS.find((provider) => provider.id === id)?.name ?? id
}
