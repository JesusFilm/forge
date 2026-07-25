import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"

import type { WatchRouteManifest } from "@/services/watch-route-manifest.service"

export const VIDEO_LIBRARY_PAGE_SIZE = 30
export const VIDEO_LIBRARY_MAX_PAGE_SIZE = 200
export const VIDEO_LIBRARY_MAX_QUERY_LENGTH = 120
export const VIDEO_LIBRARY_MAX_LANGUAGE_LENGTH = 120
export const VIDEO_LIBRARY_MAX_IDENTIFIER_LENGTH = 140

export const VIDEO_LIBRARY_CATEGORIES = [
  "all",
  "collections",
  "episodes",
  "features",
  "shortFilms",
  "series",
] as const
export const VIDEO_LIBRARY_SORTS = [
  "recent",
  "oldest",
  "created",
  "createdOldest",
] as const
export const VIDEO_LIBRARY_DEFAULT_CATEGORY = "all"
export const VIDEO_LIBRARY_DEFAULT_SORT = "recent"

export type VideoLibraryCategory = (typeof VIDEO_LIBRARY_CATEGORIES)[number]
export type VideoLibrarySort = (typeof VIDEO_LIBRARY_SORTS)[number]

const VIDEO_LIBRARY_CATEGORY_LABELS: Record<
  Exclude<VideoLibraryCategory, "all">,
  readonly string[]
> = {
  collections: ["COLLECTION"],
  episodes: ["EPISODE"],
  features: ["FEATURE_FILM"],
  shortFilms: ["SHORT_FILM"],
  series: ["SERIES"],
}

const SLUG_PATTERN = /^[a-z0-9-]+$/
const VIDEO_LIBRARY_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i
const BCP47_TAG_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i
const CLOUDFLARE_IMAGE_DELIVERY_HOST = "imagedelivery.net"
const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export type VideoLibraryPagination = {
  total: number
  currentPage: number
  pageSize: number
  pageCount: number
  hasPrevious: boolean
  hasNext: boolean
  offset: number
  rangeStart: number
  rangeEnd: number
}

export function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function parseVideoLibraryPage(value: string | string[] | undefined) {
  const parsed = Number(firstSearchParam(value))
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.trunc(parsed))
}

export function parseVideoLibraryQuery(value: string | string[] | undefined) {
  return (
    firstSearchParam(value)
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, VIDEO_LIBRARY_MAX_QUERY_LENGTH) ?? ""
  )
}

export function parseVideoLibraryCategory(
  value: string | string[] | undefined,
): VideoLibraryCategory {
  const candidate = firstSearchParam(value)
  return VIDEO_LIBRARY_CATEGORIES.find((item) => item === candidate) ?? "all"
}

export function matchesVideoLibraryCategory(
  label: string | null | undefined,
  category: VideoLibraryCategory,
) {
  if (category === "all") return true
  return VIDEO_LIBRARY_CATEGORY_LABELS[category].includes(label ?? "")
}

export function parseVideoLibraryLanguage(
  value: string | string[] | undefined,
) {
  return (
    firstSearchParam(value)
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, VIDEO_LIBRARY_MAX_LANGUAGE_LENGTH) ?? ""
  )
}

export function parseVideoLibrarySort(
  value: string | string[] | undefined,
): VideoLibrarySort {
  const candidate = firstSearchParam(value)
  return VIDEO_LIBRARY_SORTS.find((item) => item === candidate) ?? "recent"
}

function parseVideoLibraryIdentifier(value: string | string[] | undefined) {
  const candidate =
    firstSearchParam(value)
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, VIDEO_LIBRARY_MAX_IDENTIFIER_LENGTH) ?? ""

  return VIDEO_LIBRARY_IDENTIFIER_PATTERN.test(candidate) ? candidate : ""
}

export function parseVideoLibrarySelectedVideo(
  value: string | string[] | undefined,
) {
  return parseVideoLibraryIdentifier(value)
}

export function parseVideoLibraryCollection(
  value: string | string[] | undefined,
) {
  return parseVideoLibraryIdentifier(value)
}

export function videoLibraryHref({
  category,
  collection,
  language,
  page,
  query,
  sort,
  video,
}: {
  category?: VideoLibraryCategory
  collection?: string | null
  language?: string
  page: number
  query?: string
  sort?: VideoLibrarySort
  video?: string | null
}) {
  const params = new URLSearchParams()
  const normalizedPage = Number.isFinite(page)
    ? Math.max(1, Math.trunc(page))
    : 1
  const normalizedQuery = parseVideoLibraryQuery(query)
  const normalizedCategory = parseVideoLibraryCategory(category)
  const normalizedCollection = parseVideoLibraryCollection(
    collection ?? undefined,
  )
  const normalizedLanguage = parseVideoLibraryLanguage(language)
  const normalizedVideo = parseVideoLibrarySelectedVideo(video ?? undefined)
  const normalizedSort = parseVideoLibrarySort(sort)

  if (normalizedPage > 1) {
    params.set("page", normalizedPage.toString())
  }
  if (normalizedQuery) {
    params.set("q", normalizedQuery)
  }
  if (normalizedCategory !== VIDEO_LIBRARY_DEFAULT_CATEGORY) {
    params.set("type", normalizedCategory)
  }
  if (normalizedLanguage) {
    params.set("language", normalizedLanguage)
  }
  if (normalizedCollection) {
    params.set("collection", normalizedCollection)
  }
  if (normalizedVideo) {
    params.set("video", normalizedVideo)
  }
  if (normalizedSort !== VIDEO_LIBRARY_DEFAULT_SORT) {
    params.set("sort", normalizedSort)
  }

  const suffix = params.toString()
  return suffix ? `/dashboard/videos?${suffix}` : "/dashboard/videos"
}

export function hasActiveVideoLibraryFilters({
  category,
  collection,
  language,
  query,
}: {
  category: VideoLibraryCategory
  collection?: string
  language: string
  query: string
}) {
  return (
    parseVideoLibraryQuery(query).length > 0 ||
    parseVideoLibraryCategory(category) !== VIDEO_LIBRARY_DEFAULT_CATEGORY ||
    parseVideoLibraryCollection(collection).length > 0 ||
    parseVideoLibraryLanguage(language).length > 0
  )
}

export function normalizeVideoLibraryPageSize(value: number | undefined) {
  if (!Number.isFinite(value)) return VIDEO_LIBRARY_PAGE_SIZE
  return Math.min(
    Math.max(Math.trunc(value ?? VIDEO_LIBRARY_PAGE_SIZE), 1),
    VIDEO_LIBRARY_MAX_PAGE_SIZE,
  )
}

export function createVideoLibraryPagination({
  total,
  requestedPage,
  pageSize,
}: {
  total: number
  requestedPage: number
  pageSize?: number
}): VideoLibraryPagination {
  const normalizedTotal = Math.max(0, Math.trunc(total))
  const normalizedPageSize = normalizeVideoLibraryPageSize(pageSize)
  const pageCount = Math.max(1, Math.ceil(normalizedTotal / normalizedPageSize))
  const normalizedRequestedPage = Number.isFinite(requestedPage)
    ? Math.max(1, Math.trunc(requestedPage))
    : 1
  const currentPage = Math.min(normalizedRequestedPage, pageCount)
  const offset = (currentPage - 1) * normalizedPageSize

  return {
    total: normalizedTotal,
    currentPage,
    pageSize: normalizedPageSize,
    pageCount,
    hasPrevious: currentPage > 1,
    hasNext: currentPage < pageCount,
    offset,
    rangeStart: normalizedTotal === 0 ? 0 : offset + 1,
    rangeEnd: Math.min(normalizedTotal, offset + normalizedPageSize),
  }
}

function cleanSlug(value: string | null | undefined) {
  const slug = value?.trim().toLowerCase() ?? ""
  return SLUG_PATTERN.test(slug) ? slug : null
}

export function isPublicAudioLanguageSlug(value: string | null | undefined) {
  const slug = cleanSlug(value)
  if (!slug) return false
  return !BCP47_TAG_PATTERN.test(slug)
}

export function normalizeVideoThumbnailUrl(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.hostname !== CLOUDFLARE_IMAGE_DELIVERY_HOST) return trimmed

    const pathParts = url.pathname.split("/").filter(Boolean)
    if (pathParts.length === 2) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/public`
    }
    return url.toString()
  } catch {
    return trimmed
  }
}

export function formatVideoUpdatedRelative(value: Date, now = new Date()) {
  const diffMs = value.getTime() - now.getTime()
  const absDiffMs = Math.abs(diffMs)
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" })

  if (absDiffMs < 45 * SECOND_MS) return "just now"

  if (absDiffMs < 90 * SECOND_MS) {
    return formatter.format(Math.sign(diffMs), "minute")
  }

  if (absDiffMs < 45 * MINUTE_MS) {
    return formatter.format(Math.round(diffMs / MINUTE_MS), "minute")
  }

  if (absDiffMs < 90 * MINUTE_MS) {
    return formatter.format(Math.sign(diffMs), "hour")
  }

  if (absDiffMs < 22 * HOUR_MS) {
    return formatter.format(Math.round(diffMs / HOUR_MS), "hour")
  }

  if (absDiffMs < 36 * HOUR_MS) {
    return formatter.format(Math.sign(diffMs), "day")
  }

  if (absDiffMs < 26 * DAY_MS) {
    return formatter.format(Math.round(diffMs / DAY_MS), "day")
  }

  if (absDiffMs < 45 * DAY_MS) {
    return formatter.format(Math.sign(diffMs), "month")
  }

  if (absDiffMs < 320 * DAY_MS) {
    return formatter.format(Math.round(diffMs / (30 * DAY_MS)), "month")
  }

  if (absDiffMs < 548 * DAY_MS) {
    return formatter.format(Math.sign(diffMs), "year")
  }

  return formatter.format(Math.round(diffMs / (365 * DAY_MS)), "year")
}

function preferredPublicLanguageSlug(slugs: Array<string | null | undefined>) {
  const candidates = Array.from(
    new Set(slugs.map(cleanSlug).filter((slug): slug is string => !!slug)),
  ).filter(isPublicAudioLanguageSlug)

  return candidates.find((slug) => slug === "english") ?? candidates[0] ?? null
}

function cleanWebOrigin(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.origin
  } catch {
    return null
  }
}

function manifestLanguageSlugsForContent(
  manifest: WatchRouteManifest | null | undefined,
  contentSlug: string,
) {
  if (!manifest?.contentSlugs.includes(contentSlug)) return []

  const languageIndexes =
    manifest.audioLanguageIndexesByContent?.[contentSlug] ?? []
  return languageIndexes
    .map((index) => manifest.audioLanguageSlugs[index])
    .filter((slug): slug is string => !!slug)
}

export function buildVideoVisitorUrl({
  contentSlug,
  languageSlug,
  webOrigin,
}: {
  contentSlug: string
  languageSlug: string
  webOrigin: string
}) {
  const normalizedContentSlug = cleanSlug(contentSlug)
  const normalizedLanguageSlug = cleanSlug(languageSlug)
  const normalizedWebOrigin = cleanWebOrigin(webOrigin)
  if (!normalizedContentSlug || !normalizedLanguageSlug || !normalizedWebOrigin)
    return null
  if (!isPublicAudioLanguageSlug(normalizedLanguageSlug)) return null

  return `${normalizedWebOrigin}/watch${buildCanonicalWatchVideoPath(
    normalizedContentSlug,
    normalizedLanguageSlug,
  )}`
}

export function resolveVideoVisitorUrl({
  contentSlug,
  languageSlugs = [],
  manifest,
  webOrigin,
}: {
  contentSlug: string
  languageSlugs?: Array<string | null | undefined>
  manifest?: WatchRouteManifest | null
  webOrigin: string
}) {
  const normalizedContentSlug = cleanSlug(contentSlug)
  if (!normalizedContentSlug) return null

  const manifestLanguage = preferredPublicLanguageSlug(
    manifestLanguageSlugsForContent(manifest, normalizedContentSlug),
  )
  if (manifestLanguage) {
    return buildVideoVisitorUrl({
      contentSlug: normalizedContentSlug,
      languageSlug: manifestLanguage,
      webOrigin,
    })
  }

  const rowLanguage = preferredPublicLanguageSlug(languageSlugs)
  return rowLanguage
    ? buildVideoVisitorUrl({
        contentSlug: normalizedContentSlug,
        languageSlug: rowLanguage,
        webOrigin,
      })
    : null
}
