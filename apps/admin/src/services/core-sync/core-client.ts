// Core API GraphQL client — fetches data from the JesusFilm Core gateway.
//
// Uses plain fetch (no Apollo/urql overhead for a sync-only client).
// Lazy singleton pattern matching apps/manager/src/services/storage.ts.

import { env } from "@/config/env"

const DEFAULT_URL = "https://api-gateway.central.jesusfilm.org/"

type CoreQueryResult<T> = {
  data: T | null
  errors?: Array<{ message: string }>
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

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    throw new Error(`Core API returned ${res.status}: ${res.statusText}`)
  }

  return res.json() as Promise<CoreQueryResult<T>>
}
