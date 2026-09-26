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

/** A model as the API names it: which provider, which model. */
export interface ModelRef {
  provider: string
  model: string
}

export const sameModel = (a: ModelRef | null | undefined, b: ModelRef) => a?.provider === b.provider && a.model === b.model

/** How a model is named to the user: 「平台模型（…）」 or 「OpenAI · gpt-5」. */
export function modelLabel(choice: ModelRef): string {
  return choice.provider === 'platform' ? `平台模型（${choice.model}）` : `${providerName(choice.provider)} · ${choice.model}`
}
