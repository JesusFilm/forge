import { getCmsGateway } from "@/cms/gateway"
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
  parentRelations?: Array<{ parentDocumentId: string; order: number | null }>
  coverage: {
    subtitles: { human: number; ai: number }
    audio: { human: number; ai: number }
  }
}

async function fetchVideoCoverage(
  languageIds?: string[],
): Promise<CmsVideoCoverage[]> {
  const gateway = getCmsGateway()
  return gateway.getVideoCoverage(languageIds)
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
