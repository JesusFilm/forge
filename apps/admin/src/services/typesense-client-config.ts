import { env } from "@/config/env"

import { TypesenseClient } from "./typesense-client"

export function createConfiguredTypesenseClient(
  timeoutMs = 2_000,
): TypesenseClient | null {
  const apiKey = resolveTypesenseWatchSearchApiKey({
    searchApiKey: env.TYPESENSE_SEARCH_API_KEY,
    legacyApiKey: env.TYPESENSE_API_KEY,
    allowLegacyFallback: true,
  })
  if (!env.TYPESENSE_HOST || !apiKey) return null
  return new TypesenseClient({
    host: env.TYPESENSE_HOST,
    apiKey,
    timeoutMs,
  })
}

export function resolveTypesenseWatchSearchApiKey(input: {
  searchApiKey?: string
  legacyApiKey?: string
  allowLegacyFallback: boolean
}): string | undefined {
  return (
    input.searchApiKey ??
    (input.allowLegacyFallback ? input.legacyApiKey : undefined)
  )
}

export function watchSearchSuggestionsEnabled(): boolean {
  if (env.WATCH_SEARCH_SUGGESTIONS_ENABLED != null) {
    return env.WATCH_SEARCH_SUGGESTIONS_ENABLED === "true"
  }
  return env.NODE_ENV !== "production"
}
