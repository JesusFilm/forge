// Core API GraphQL client — fetches data from the JesusFilm Core gateway.
//
// Uses plain fetch (no Apollo/urql overhead for a sync-only client).
// Lazy singleton pattern matching apps/manager/src/services/storage.ts.

import { env } from "@/config/env"

const DEFAULT_URL = "https://api-gateway.central.jesusfilm.org/"
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_RETRIES = 2

type CoreQueryResult<T> = {
  data: T | null
  errors?: Array<{ message: string }>
}

export class CoreGraphQLError extends Error {
  constructor(readonly errors: Array<{ message: string }>) {
    super(
      `Core API returned GraphQL errors: ${errors
        .map((error) => error.message)
        .join("; ")}`,
    )
    this.name = "CoreGraphQLError"
  }
}

export async function coreQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<CoreQueryResult<T>> {
  const url = env.CORE_API_URL ?? DEFAULT_URL
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (env.CORE_API_TOKEN) {
    headers.authorization = `Bearer ${env.CORE_API_TOKEN}`
  }

  const retries = env.CORE_API_RETRIES ?? DEFAULT_RETRIES
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(
          env.CORE_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
        ),
      })

      if (!res.ok) {
        throw new Error(`Core API returned ${res.status}: ${res.statusText}`)
      }

      const json = (await res.json()) as CoreQueryResult<T>
      if (json.errors && json.errors.length > 0) {
        throw new CoreGraphQLError(json.errors)
      }

      return json
    } catch (error) {
      lastError = error
      if (error instanceof CoreGraphQLError) throw error
      if (attempt === retries) break
      const delayMs = 500 * 2 ** attempt
      console.warn(
        JSON.stringify({
          event: "core-sync.core-query.retry",
          attempt: attempt + 1,
          retries,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError
}
