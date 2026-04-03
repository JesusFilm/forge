import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { env } from "@/config/env"
import { createSwrCache } from "@/lib/swr-cache"

// ---------------------------------------------------------------------------
// Types from CMS /api/language-geo endpoint
// ---------------------------------------------------------------------------

type CmsLanguageGeo = {
  continents: Array<{ id: string; name: string }>
  countries: Array<{ id: string; name: string; continentId: string }>
  languages: Array<{
    id: string
    englishLabel: string
    nativeLabel: string
    countryIds: string[]
    continentIds: string[]
    countrySpeakers: Record<string, number>
  }>
}

// ---------------------------------------------------------------------------
// Fetch from CMS language-geo endpoint
// ---------------------------------------------------------------------------

async function fetchLanguagePayload(): Promise<string> {
  const url = `${env.STRAPI_URL}/api/language-geo`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(
      `CMS /api/language-geo returned ${response.status}: ${await response.text()}`,
    )
  }

  const data = (await response.json()) as CmsLanguageGeo
  return JSON.stringify(data)
}

// ---------------------------------------------------------------------------
// SWR cache (geo data changes only on core sync)
// Caches pre-serialized JSON string for zero-cost response serving.
// ---------------------------------------------------------------------------

export const languageCache = createSwrCache({
  fetcher: fetchLanguagePayload,
  ttlMs: 24 * 60 * 60_000, // 24 hours — geo data changes only on core sync
  maxStaleMs: 48 * 60 * 60_000, // 48 hours — hard limit
  label: "language-cache",
})

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  try {
    const payload = await languageCache.get()
    return new Response(payload, {
      headers: { "Content-Type": "application/json" },
    })
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch language data" },
      { status: 502 },
    )
  }
}
