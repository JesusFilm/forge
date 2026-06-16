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

const WATCH_LANGUAGE_INVENTORY_LIMIT = 1_000

const watchLanguageInventoryItemFragment = adminGraphql(`
  fragment WatchLanguageInventoryItemFields on WatchLanguageInventoryItem @_unmask {
    id
    coreId
    slug
    title
    description
    imageUrl
    imageAlt
    label
    availability
    watchLanguageSlug
    parentSlug
    parentTitle
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

type WatchLanguageInventoryRaw = NonNullable<
  AdminResultOf<
    typeof getWatchLanguageInventoryOperation
  >["watchLanguageInventory"]
>

type WatchLanguageInventoryItemRaw =
  WatchLanguageInventoryRaw["audioVideos"][number]

export type WatchLanguageInventoryAvailability =
  WatchLanguageInventoryItemRaw["availability"]

export type WatchLanguageInventoryCard = {
  id: string
  coreId: string
  title: string
  description: string | null
  imageUrl: string | null
  imageAlt: string
  label: string | null
  availability: WatchLanguageInventoryAvailability
  href: Route | null
  watchLanguageSlug: string
  parentTitle: string | null
  durationSeconds: number | null
  childCount: number
  publishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type WatchLanguageInventoryModel = {
  languageSlug: string
  languageName: string
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

const fetchWatchLanguageInventory = unstable_cache(
  queryWatchLanguageInventory,
  ["watch-language-inventory"],
  {
    revalidate: 60,
    tags: [WATCH_CACHE_TAGS.video, WATCH_CACHE_TAGS.series],
  },
)

function labelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function languageNameFromJson(name: unknown, slug: string): string {
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
  return labelFromSlug(slug)
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
  return `Free Gospel Video Library for ${primaryLanguageNameForSeo(languageName)}-Speaking Audiences | Jesus Film Project`
}

export function watchLanguageInventorySeoDescription(
  languageName: string,
): string {
  return `Watch free Gospel videos, Jesus films, Bible stories, and discipleship series for ${watchLanguageSpeakingAudience(languageName)}, with audio and subtitles in ${languageName}.`
}

function buildInventoryHref(item: WatchLanguageInventoryItemRaw): Route | null {
  const slug = tryAsContentSlug(item.slug)
  const lang = tryAsLocaleSlug(item.watchLanguageSlug)
  if (!slug || !lang) return null

  if (item.parentSlug) {
    const parent = tryAsContentSlug(item.parentSlug)
    if (parent) return watchEpisodePath(parent, slug, lang)
  }

  return watchVideoPath(slug, lang)
}

function normalizeCard(item: WatchLanguageInventoryItemRaw) {
  return {
    id: item.id,
    coreId: item.coreId,
    title: item.title,
    description: item.description ?? null,
    imageUrl: item.imageUrl ?? null,
    imageAlt: item.imageAlt ?? item.title,
    label: item.label ?? null,
    availability: item.availability,
    href: buildInventoryHref(item),
    watchLanguageSlug: item.watchLanguageSlug,
    parentTitle: item.parentTitle ?? null,
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

  return {
    languageSlug: resolvedLanguageSlug,
    languageName,
    counts: raw.counts,
    promoted: raw.promoted.map(normalizeCard),
    audioCollections: raw.audioCollections.map(normalizeCard),
    audioVideos: raw.audioVideos.map(normalizeCard),
    subtitleOnlyVideos: raw.subtitleOnlyVideos.map(normalizeCard),
  }
}
