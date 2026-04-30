"use server"

/**
 * Throwaway operator harness — server action backing the third
 * column of /watch/demo-keyword-search.
 *
 * Proxies a query to the watch project's Algolia index using
 * `ALGOLIA_SEARCH_API_KEY` (the watch project's `ALGOLIA_SERVER_API_KEY`
 * value, which is unrestricted; the public `NEXT_PUBLIC_ALGOLIA_API_KEY`
 * is referer-locked to the watch domain and cannot be used from
 * admin.jesusfilm.org).
 *
 * Lifetime: this exists only while we refine admin's hybrid +
 * keyword-first ranking. At R8 cutover, delete this file, drop the
 * Algolia env vars from Doppler / Railway, and remove the third pane
 * from `demo-search-client.tsx`. No service layer, no GraphQL surface,
 * no REST endpoint — that is the point.
 *
 * `locale` is accepted for log context / forward compatibility but
 * NOT forwarded to Algolia in v1 — the index returns multi-locale
 * hits and the demo renders `titles[0]` defensively.
 */

import { env } from "@/config/env"

const ALGOLIA_TIMEOUT_MS = 5000
const MAX_LIMIT = 50

export type AlgoliaHit = {
  videoId: string
  title: string | null
  description: string | null
}

export type AlgoliaSearchResult = {
  hits: AlgoliaHit[]
}

type AlgoliaRawHit = {
  videoId?: unknown
  titles?: unknown
  description?: unknown
}

type AlgoliaRawResponse = {
  hits?: AlgoliaRawHit[]
}

export async function searchAlgolia(args: {
  q: string
  locale: string
  limit: number
}): Promise<AlgoliaSearchResult> {
  const appId = env.ALGOLIA_APP_ID
  const apiKey = env.ALGOLIA_SEARCH_API_KEY
  const index = env.ALGOLIA_INDEX
  if (!appId || !apiKey || !index) {
    throw new Error("algolia_not_configured")
  }

  const hitsPerPage = Math.max(
    1,
    Math.min(MAX_LIMIT, Math.floor(Number(args.limit) || 10)),
  )

  const url = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/query`

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Algolia-API-Key": apiKey,
        "X-Algolia-Application-Id": appId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: args.q, hitsPerPage }),
      signal: AbortSignal.timeout(ALGOLIA_TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(
      `[demo-search][algolia] fetch failed msg=${sanitize(msg)} q=${sanitize(args.q)}`,
    )
    throw new Error("algolia_upstream_error")
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    console.error(
      `[demo-search][algolia] upstream error status=${response.status} body=${sanitize(body)} q=${sanitize(args.q)}`,
    )
    throw new Error("algolia_upstream_error")
  }

  let payload: AlgoliaRawResponse
  try {
    payload = (await response.json()) as AlgoliaRawResponse
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(
      `[demo-search][algolia] invalid JSON msg=${sanitize(msg)} q=${sanitize(args.q)}`,
    )
    throw new Error("algolia_upstream_error")
  }

  const rawHits = Array.isArray(payload.hits) ? payload.hits : []
  const hits: AlgoliaHit[] = []
  for (const raw of rawHits) {
    const videoId = typeof raw.videoId === "string" ? raw.videoId : null
    if (!videoId) continue
    hits.push({
      videoId,
      title: pickFirstString(raw.titles),
      description: pickFirstString(raw.description),
    })
  }

  return { hits }
}

function pickFirstString(value: unknown): string | null {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v.length > 0) return v
    }
  }
  return null
}

/** Strip CR/LF/TAB from log inputs and clamp length so a malicious or
 * just-large value can't pollute structured-log lines. */
function sanitize(input: string): string {
  const stripped = input.replace(/[\r\n\t]/g, " ")
  return stripped.length > 200 ? `${stripped.slice(0, 200)}…` : stripped
}
