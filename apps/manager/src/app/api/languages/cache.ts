import { env } from "@/config/env"
import { createSwrCache } from "@/lib/swr-cache"

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

async function fetchLanguageGeo(): Promise<string> {
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

export const languageCache = createSwrCache({
  fetcher: fetchLanguageGeo,
  ttlMs: 24 * 60 * 60_000,
  maxStaleMs: 48 * 60 * 60_000,
  label: "language-cache",
})
