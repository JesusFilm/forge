import { env } from "@/config/env"

import { TypesenseClient } from "./typesense-client"

export function createConfiguredTypesenseClient(
  timeoutMs = 2_000,
): TypesenseClient | null {
  if (!env.TYPESENSE_HOST || !env.TYPESENSE_API_KEY) return null
  return new TypesenseClient({
    host: env.TYPESENSE_HOST,
    apiKey: env.TYPESENSE_API_KEY,
    timeoutMs,
  })
}

export function watchSearchSuggestionsEnabled(): boolean {
  if (env.WATCH_SEARCH_SUGGESTIONS_ENABLED != null) {
    return env.WATCH_SEARCH_SUGGESTIONS_ENABLED === "true"
  }
  return env.NODE_ENV !== "production"
}
