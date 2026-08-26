import type { Route } from "next"
import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"

import adminClient from "@/lib/admin-client"
import {
  isPublicWatchHomeLanguageSlug,
  publicWatchHomeLanguageSlugForLocale,
} from "@/lib/locale"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import { WATCH_CACHE_TAGS } from "@/lib/watch-cache-tags"
import { getWatchRouteManifest } from "@/lib/watch-route-manifest"

const WATCH_LANGUAGE_INVENTORY_LIMIT = 1_000
const WATCH_LANGUAGE_SWITCHER_LIMIT = 5_000
const WATCH_LANGUAGE_SWITCHER_PAGE_SIZE = 500

const watchLanguageInventoryItemFragment = adminGraphql(`
  fragment WatchLanguageInventoryItemFields on WatchLanguageInventoryItem @_unmask {
    id
    coreId
    slug
    title
    description
    imageUrl
    imageAlt
    muxPlaybackId
    label
    availability
    watchLanguageSlug
    parentSlug
    parentTitle
    parentOrder
    durationSeconds
    childCount
    publishedAt
    createdAt
    updatedAt
  }
`)

const getWatchLanguageInventoryOperation = adminGraphql(
  `
    query GetWatchLanguageInventory($languageSlug: String!, $limit: Int) {
      watchLanguageInventory(languageSlug: $languageSlug, limit: $limit) {
        language {
          slug
          bcp47
          name
        }
        counts {
          audioCollections
          audioVideos
          subtitleOnlyVideos
          total
        }
        promoted {
          ...WatchLanguageInventoryItemFields
        }
        audioCollections {
          ...WatchLanguageInventoryItemFields
        }
        audioVideos {
          ...WatchLanguageInventoryItemFields
        }
        subtitleOnlyVideos {
          ...WatchLanguageInventoryItemFields
        }
      }
    }
  `,
  [watchLanguageInventoryItemFragment],
)

const getWatchLanguageInventoryLanguagesOperation = adminGraphql(`
  query GetWatchLanguageInventoryLanguages($limit: Int, $offset: Int) {
    languages(limit: $limit, offset: $offset) {
      slug
      bcp47
      name
    }
  }
`)

type WatchLanguageInventoryRaw = NonNullable<
  AdminResultOf<
    typeof getWatchLanguageInventoryOperation
  >["watchLanguageInventory"]
>

type WatchLanguageInventoryItemRaw =
  WatchLanguageInventoryRaw["audioVideos"][number]

type WatchLanguageInventoryLanguageRaw = NonNullable<
  AdminResultOf<typeof getWatchLanguageInventoryLanguagesOperation>["languages"]
>[number]

export type WatchLanguageInventoryAvailability =
  WatchLanguageInventoryItemRaw["availability"]

export type WatchLanguageInventoryCard = {
  id: string
  coreId: string
  slug: string
  title: string
  description: string | null
  imageUrl: string | null
  imageAlt: string
  /**
   * Frame source for videos with no authored artwork. Kept separate from
   * `imageUrl` so surfaces that need a specific resolution (or that pick a
   * hero by "first item with real artwork") can decide for themselves.
   */
  muxPlaybackId: string | null
  label: string | null
  availability: WatchLanguageInventoryAvailability
  href: Route | null
  watchLanguageSlug: string
  parentSlug: string | null
  parentTitle: string | null
  parentOrder?: number | null
  durationSeconds: number | null
  childCount: number
  publishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type WatchLanguageInventorySwitcherLanguage = {
  slug: string
  languageName: string
  nativeName: string | null
  bcp47: string | null
}

export type WatchLanguageInventoryModel = {
  languageSlug: string
  languageName: string
  languageNativeName: string | null
  switcherLanguages: WatchLanguageInventorySwitcherLanguage[]
  counts: WatchLanguageInventoryRaw["counts"]
  promoted: WatchLanguageInventoryCard[]
  audioCollections: WatchLanguageInventoryCard[]
  audioVideos: WatchLanguageInventoryCard[]
  subtitleOnlyVideos: WatchLanguageInventoryCard[]
}

type ErrorLike = { message?: string }

function graphqlError(result: {
  error?: ErrorLike
  errors?: readonly unknown[]
}): Error | null {
  if (result.error) return new Error(result.error.message ?? "GraphQL error")
  if (result.errors?.length) return new Error("GraphQL errors")
  return null
}

async function queryWatchLanguageInventory(
  languageSlug: string,
): Promise<WatchLanguageInventoryRaw> {
  const result = await adminClient.query({
    query: getWatchLanguageInventoryOperation,
    variables: {
      languageSlug,
      limit: WATCH_LANGUAGE_INVENTORY_LIMIT,
    },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error
  if (!result.data?.watchLanguageInventory) {
    throw new Error("Watch language inventory response was empty")
  }
  return result.data.watchLanguageInventory
}

async function queryWatchLanguageInventoryLanguages(): Promise<
  WatchLanguageInventoryLanguageRaw[]
> {
  const languages: WatchLanguageInventoryLanguageRaw[] = []

  for (
    let offset = 0;
    offset < WATCH_LANGUAGE_SWITCHER_LIMIT;
    offset += WATCH_LANGUAGE_SWITCHER_PAGE_SIZE
  ) {
    const result = await adminClient.query({
      query: getWatchLanguageInventoryLanguagesOperation,
      variables: {
        limit: WATCH_LANGUAGE_SWITCHER_PAGE_SIZE,
        offset,
      },
      fetchPolicy: "no-cache",
    })

    const error = graphqlError(
      result as { error?: ErrorLike; errors?: unknown[] },
    )
    if (error) throw error

    const page = result.data?.languages ?? []
    languages.push(...page)

    if (page.length < WATCH_LANGUAGE_SWITCHER_PAGE_SIZE) break
  }

  return languages
}

const fetchWatchLanguageInventory = unstable_cache(
  queryWatchLanguageInventory,
  ["watch-language-inventory"],
  {
    revalidate: 60,
    tags: [WATCH_CACHE_TAGS.video, WATCH_CACHE_TAGS.series],
  },
)

const fetchWatchLanguageInventoryLanguages = unstable_cache(
  queryWatchLanguageInventoryLanguages,
  ["watch-language-inventory-languages", "paginated"],
  {
    revalidate: 3600,
    tags: [WATCH_CACHE_TAGS.video, WATCH_CACHE_TAGS.routeManifest],
  },
)

function labelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function firstLocalizedName(name: unknown): string | null {
  if (name && typeof name === "object" && !Array.isArray(name)) {
    const record = name as Record<string, unknown>
    for (const key of ["en", "name", "native", "nativeName", "value"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
    for (const value of Object.values(record)) {
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  if (typeof name === "string" && name.trim()) return name.trim()
  return null
}

function languageNameFromJson(name: unknown, slug: string): string {
  return firstLocalizedName(name) ?? labelFromSlug(slug)
}

function nativeLanguageNameFromJson(
  name: unknown,
  bcp47: string | null | undefined,
  englishName: string,
): string | null {
  if (!name || typeof name !== "object" || Array.isArray(name)) return null
  const record = name as Record<string, unknown>
  const candidates = [
    bcp47,
    bcp47?.split("-")[0],
    "native",
    "nativeName",
    "local",
  ].filter((candidate): candidate is string => candidate != null)

  for (const candidate of candidates) {
    const value = record[candidate]
    if (
      typeof value === "string" &&
      value.trim() &&
      value.trim().toLowerCase() !== englishName.toLowerCase()
    ) {
      return value.trim()
    }
  }

  return null
}

function switcherLanguageFromRaw(
  language: WatchLanguageInventoryLanguageRaw,
): WatchLanguageInventorySwitcherLanguage | null {
  const slug = language.slug
  if (!slug || !isPublicWatchHomeLanguageSlug(slug)) return null
  const languageName = languageNameFromJson(language.name, slug)
  return {
    slug,
    languageName,
    nativeName: nativeLanguageNameFromJson(
      language.name,
      language.bcp47,
      languageName,
    ),
    bcp47: language.bcp47 ?? null,
  }
}

function uniqueSwitcherLanguages(
  languages: WatchLanguageInventorySwitcherLanguage[],
): WatchLanguageInventorySwitcherLanguage[] {
  const bySlug = new Map<string, WatchLanguageInventorySwitcherLanguage>()
  for (const language of languages) {
    if (!bySlug.has(language.slug)) bySlug.set(language.slug, language)
  }
  return [...bySlug.values()]
}

async function resolveSwitcherLanguages(
  current: WatchLanguageInventorySwitcherLanguage,
): Promise<WatchLanguageInventorySwitcherLanguage[]> {
  const [languages, manifest] = await Promise.all([
    fetchWatchLanguageInventoryLanguages(),
    getWatchRouteManifest(),
  ])
  const manifestLanguageSlugs = new Set(manifest?.audioLanguageSlugs ?? [])
  const options = languages
    .flatMap((language) => {
      const option = switcherLanguageFromRaw(language)
      return option ? [option] : []
    })
    .filter(
      (option) =>
        manifestLanguageSlugs.size === 0 ||
        manifestLanguageSlugs.has(option.slug) ||
        option.slug === current.slug,
    )

  return uniqueSwitcherLanguages([current, ...options]).sort((a, b) => {
    if (a.slug === current.slug) return -1
    if (b.slug === current.slug) return 1
    return a.languageName.localeCompare(b.languageName)
  })
}

export function primaryLanguageNameForSeo(languageName: string): string {
  const trimmed = languageName.trim()
  const [primary] = trimmed.split(",")
  return primary?.trim() || trimmed || "Global"
}

export function watchLanguageSpeakingAudience(languageName: string): string {
  return `${primaryLanguageNameForSeo(languageName)}-speaking audiences`
}

export function watchLanguageInventorySeoTitle(languageName: string): string {
  return `Free Christian Video Library for ${primaryLanguageNameForSeo(languageName)}-Speaking Audiences | Jesus Film Project`
}

export function watchLanguageInventorySeoDescription(
  languageName: string,
): string {
  return `Watch free Christian videos, Jesus films, Bible stories, and discipleship series for ${watchLanguageSpeakingAudience(languageName)}, with fully dubbed videos and subtitles in ${languageName}.`
}

function buildInventoryHref(
  item: WatchLanguageInventoryItemRaw,
  inventoryLanguageSlug: string,
): Route | null {
  const slug = tryAsContentSlug(item.slug)
  const lang = tryAsLocaleSlug(item.watchLanguageSlug)
  if (!slug || !lang) return null

  const subtitleLanguage =
    item.availability === "SUBTITLE_ONLY"
      ? tryAsLocaleSlug(inventoryLanguageSlug)
      : null
  if (item.availability === "SUBTITLE_ONLY" && !subtitleLanguage) return null
  const options = subtitleLanguage ? { subtitleLanguage } : undefined

  if (item.parentSlug) {
    const parent = tryAsContentSlug(item.parentSlug)
    if (parent) return watchEpisodePath(parent, slug, lang, options)
  }

  return watchVideoPath(slug, lang, options)
}

function normalizeCard(
  item: WatchLanguageInventoryItemRaw,
  inventoryLanguageSlug: string,
) {
  return {
    id: item.id,
    coreId: item.coreId,
    slug: item.slug,
    title: item.title,
    description: item.description ?? null,
    imageUrl: item.imageUrl ?? null,
    imageAlt: item.imageAlt ?? item.title,
    muxPlaybackId: item.muxPlaybackId ?? null,
    label: item.label ?? null,
    availability: item.availability,
    href: buildInventoryHref(item, inventoryLanguageSlug),
    watchLanguageSlug: item.watchLanguageSlug,
    parentSlug: item.parentSlug ?? null,
    parentTitle: item.parentTitle ?? null,
    parentOrder: item.parentOrder ?? null,
    durationSeconds: item.durationSeconds ?? null,
    childCount: item.childCount,
    publishedAt: item.publishedAt ?? null,
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
  } satisfies WatchLanguageInventoryCard
}

export async function resolveWatchLanguageInventory(
  locale: string,
  routeLanguageSegment?: string | null,
): Promise<WatchLanguageInventoryModel> {
  const languageSlug =
    routeLanguageSegment && isPublicWatchHomeLanguageSlug(routeLanguageSegment)
      ? routeLanguageSegment
      : (publicWatchHomeLanguageSlugForLocale(locale) ?? "english")
  const raw = await fetchWatchLanguageInventory(languageSlug)
  const resolvedLanguageSlug = raw.language?.slug ?? languageSlug
  const languageName = languageNameFromJson(
    raw.language?.name,
    resolvedLanguageSlug,
  )
  const languageNativeName = nativeLanguageNameFromJson(
    raw.language?.name,
    raw.language?.bcp47,
    languageName,
  )
  const currentSwitcherLanguage = {
    slug: resolvedLanguageSlug,
    languageName,
    nativeName: languageNativeName,
    bcp47: raw.language?.bcp47 ?? null,
  } satisfies WatchLanguageInventorySwitcherLanguage
  const switcherLanguages = await resolveSwitcherLanguages(
    currentSwitcherLanguage,
  )
  const normalizeInventoryCard = (item: WatchLanguageInventoryItemRaw) =>
    normalizeCard(item, resolvedLanguageSlug)

  return {
    languageSlug: resolvedLanguageSlug,
    languageName,
    languageNativeName,
    switcherLanguages,
    counts: raw.counts,
    promoted: raw.promoted.map(normalizeInventoryCard),
    audioCollections: raw.audioCollections.map(normalizeInventoryCard),
    audioVideos: raw.audioVideos.map(normalizeInventoryCard),
    subtitleOnlyVideos: raw.subtitleOnlyVideos.map(normalizeInventoryCard),
  }
}
