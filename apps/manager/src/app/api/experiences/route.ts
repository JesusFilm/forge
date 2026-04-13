import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { env } from "@/config/env"
import { createSwrCache } from "@/lib/swr-cache"

type CmsExperience = {
  documentId: string
  slug: string | null
  title: string | null
  locale: string | null
  isHomepage: boolean
  isTemplate: boolean
  createdAt: string | null
}

async function fetchExperiences(
  languageIds?: string[],
): Promise<CmsExperience[]> {
  const params = new URLSearchParams()
  if (languageIds && languageIds.length > 0) {
    params.set("languageIds", languageIds.join(","))
  }

  const qs = params.toString()
  const url = `${env.STRAPI_URL}/api/experience-list${qs ? `?${qs}` : ""}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(
      `CMS /api/experience-list returned ${response.status}: ${await response.text()}`,
    )
  }

  const data = (await response.json()) as { experiences: CmsExperience[] }
  return data.experiences
}

function normalizeLanguageIds(languageIds: string[]): string[] {
  return Array.from(
    new Set(languageIds.map((languageId) => languageId.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))
}

function cacheKey(languageIds: string[]): string {
  return normalizeLanguageIds(languageIds).join(",")
}

const allExperiencesCache = createSwrCache({
  fetcher: () => fetchExperiences(),
  ttlMs: 2 * 60_000,
  maxStaleMs: 30 * 60_000,
  label: "experience-cache",
})

const filteredExperienceCaches = new Map<
  string,
  ReturnType<typeof createSwrCache<CmsExperience[]>>
>()

function getFilteredExperienceCache(languageIds: string[]) {
  const normalizedLanguageIds = normalizeLanguageIds(languageIds)
  const key = cacheKey(normalizedLanguageIds)
  const existing = filteredExperienceCaches.get(key)
  if (existing) return existing

  const cache = createSwrCache({
    fetcher: () => fetchExperiences(normalizedLanguageIds),
    ttlMs: 2 * 60_000,
    maxStaleMs: 30 * 60_000,
    label: `experience-cache:${key}`,
  })
  filteredExperienceCaches.set(key, cache)
  return cache
}

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const languageIds = url.searchParams.get("languageIds")?.split(",") ?? []
  const selectedLanguages = normalizeLanguageIds(languageIds)

  try {
    const experiences =
      selectedLanguages.length === 0
        ? await allExperiencesCache.get()
        : await getFilteredExperienceCache(selectedLanguages).get()

    return NextResponse.json({ experiences })
  } catch (error) {
    console.error(
      "[api/experiences] Failed to fetch experiences:",
      error instanceof Error ? error.message : "Unknown error",
    )
    return NextResponse.json(
      { error: "Failed to fetch experiences" },
      { status: 502 },
    )
  }
}
