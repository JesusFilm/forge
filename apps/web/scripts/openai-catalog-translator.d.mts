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

export type MessageContextOverride = {
  role?: string
  visibility?: string
  composition?: string
}

/**
 * The JSON shape of the `--contexts <path>` file. It replaces web's own
 * Watch contexts, web's per-key overrides, and web's search instructions.
 */
export type CatalogContexts = {
  /** Completes "... translator for Jesus Film Project, <product>." */
  product: string
  /** One surface sentence for each namespace (first key segment) in the source catalog. */
  namespaces: Record<string, string>
  /** Overrides by full dotted message key, for example "Settings.language". */
  keys?: Record<string, MessageContextOverride>
}

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
  contexts?: CatalogContexts
  /** Treat an HTTP 429 whose body names insufficient_quota as permanent. */
  stopOnQuota?: boolean
}): Promise<{
  translations: Record<string, string>
  usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}>
