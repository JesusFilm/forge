import { getCmsGateway } from "@/cms/gateway"
import { env } from "@/config/env"
import { createSwrCache } from "@/lib/swr-cache"

export type CmsVideoCoverage = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  imageUrl: string | null
  parentDocumentIds: string[]
  coverage: {
    subtitles: { human: number; ai: number }
    audio: { human: number; ai: number }
  }
}

async function fetchVideoCoverage(
  languageIds?: string[],
): Promise<CmsVideoCoverage[]> {
  const gateway = getCmsGateway()
  if (gateway.mode === "mock") {
    return gateway.getVideoCoverage(languageIds)
  }

  const params = new URLSearchParams()
  if (languageIds && languageIds.length > 0) {
    params.set("languageIds", languageIds.join(","))
  }

  const qs = params.toString()
  const url = `${env.STRAPI_URL}/api/video-coverage${qs ? `?${qs}` : ""}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(
      `CMS /api/video-coverage returned ${response.status}: ${await response.text()}`,
    )
  }

  const data = (await response.json()) as { videos: CmsVideoCoverage[] }
  return data.videos
}

export function normalizeCoverageLanguageIds(languageIds: string[]): string[] {
  return Array.from(
    new Set(languageIds.map((languageId) => languageId.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))
}

export function getFilteredVideoCoverageCacheKey(
  languageIds: string[],
): string {
  return normalizeCoverageLanguageIds(languageIds).join(",")
}

export const videoCache = createSwrCache({
  fetcher: () => fetchVideoCoverage(),
  ttlMs: 2 * 60_000,
  maxStaleMs: 30 * 60_000,
  label: "video-cache",
})

const filteredVideoCaches = new Map<
  string,
  ReturnType<typeof createSwrCache<CmsVideoCoverage[]>>
>()

export function getFilteredVideoCoverageCache(languageIds: string[]) {
  const normalizedLanguageIds = normalizeCoverageLanguageIds(languageIds)
  const cacheKey = getFilteredVideoCoverageCacheKey(normalizedLanguageIds)
  const existing = filteredVideoCaches.get(cacheKey)
  if (existing) {
    return existing
  }

  const cache = createSwrCache({
    fetcher: () => fetchVideoCoverage(normalizedLanguageIds),
    ttlMs: 2 * 60_000,
    maxStaleMs: 30 * 60_000,
    label: `video-cache:${cacheKey}`,
  })
  filteredVideoCaches.set(cacheKey, cache)
  return cache
}
