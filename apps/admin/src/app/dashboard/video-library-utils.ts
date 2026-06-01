import type { WatchRouteManifest } from "@/services/watch-route-manifest.service"

export const VIDEO_LIBRARY_PAGE_SIZE = 30
export const VIDEO_LIBRARY_MAX_PAGE_SIZE = 200

const SLUG_PATTERN = /^[a-z0-9-]+$/
const BCP47_TAG_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i
const CLOUDFLARE_IMAGE_DELIVERY_HOST = "imagedelivery.net"

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

  return `${normalizedWebOrigin}/watch/${normalizedContentSlug}.html/${normalizedLanguageSlug}.html`
}

export function resolveVideoVisitorUrl({
  contentSlug,
  manifest,
  webOrigin,
}: {
  contentSlug: string
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

  return null
}
