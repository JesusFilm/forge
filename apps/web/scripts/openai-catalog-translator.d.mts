export function isSourceEquivalent(source: string, value: string): boolean

export function messageContractError(
  key: string,
  source: string,
  value: unknown,
): string | null

export class TranslationApiError extends Error {
  readonly code: string
}

export class PermanentApiError extends TranslationApiError {}

export function requestTranslations(options: {
  apiKey: string
  locale: string
  inventoryEntry?: { countries?: Array<{ name: string }> }
  messages: Record<string, string>
  references: Record<string, string>
  model: string
  maxAttempts: number
  minimumChangeRatio: number
  fetchImpl?: typeof fetch
  waitForRetry?: (milliseconds: number) => Promise<void>
}): Promise<{
  translations: Record<string, string>
  usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}>
