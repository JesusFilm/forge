import { logWatchServerEvent } from "./watch-observability"

export type WatchSeoManifestAlternate = {
  hreflang: string
  languageSlug: string
}

export type WatchSeoManifestVideoRouteGroup = {
  contentSlug: string
  alternates: WatchSeoManifestAlternate[]
}

export type WatchSeoManifestEpisodeRouteGroup = {
  parentSlug: string
  childSlug: string
  alternates: WatchSeoManifestAlternate[]
}

export type WatchSeoManifest = {
  version: string
  generatedAt: string
  videoRouteGroups: WatchSeoManifestVideoRouteGroup[]
  episodeRouteGroups: WatchSeoManifestEpisodeRouteGroup[]
  skippedHreflangValues: Record<string, number>
}

type WatchSeoManifestCache = {
  etag: string | null
  expiresAt: number
  inFlight: Promise<WatchSeoManifest | null> | null
  manifest: WatchSeoManifest | null
}

export type WatchSeoManifestSource = () => Promise<WatchSeoManifest | null>

const WATCH_SEO_MANIFEST_CACHE_TTL_MS = 60_000
const WATCH_SEO_MANIFEST_MISS_CACHE_TTL_MS = 5_000
const WATCH_SEO_MANIFEST_TIMEOUT_MS = 10_000

let manifestCache: WatchSeoManifestCache = {
  etag: null,
  expiresAt: 0,
  inFlight: null,
  manifest: null,
}
let sourceOverride: WatchSeoManifestSource | null = null

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isAlternate(value: unknown): value is WatchSeoManifestAlternate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return isString(record.hreflang) && isString(record.languageSlug)
}

function isAlternateArray(
  value: unknown,
): value is WatchSeoManifestAlternate[] {
  return Array.isArray(value) && value.every(isAlternate)
}

function isVideoRouteGroup(
  value: unknown,
): value is WatchSeoManifestVideoRouteGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return isString(record.contentSlug) && isAlternateArray(record.alternates)
}

function isEpisodeRouteGroup(
  value: unknown,
): value is WatchSeoManifestEpisodeRouteGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    isString(record.parentSlug) &&
    isString(record.childSlug) &&
    isAlternateArray(record.alternates)
  )
}

function isSkippedHreflangValues(
  value: unknown,
): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([key, count]) =>
      key.length > 0 && Number.isInteger(count) && Number(count) >= 0,
  )
}

export function parseWatchSeoManifest(value: unknown): WatchSeoManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isString(record.version)) return null
  if (!isString(record.generatedAt)) return null
  if (
    !Array.isArray(record.videoRouteGroups) ||
    !record.videoRouteGroups.every(isVideoRouteGroup)
  ) {
    return null
  }
  if (
    !Array.isArray(record.episodeRouteGroups) ||
    !record.episodeRouteGroups.every(isEpisodeRouteGroup)
  ) {
    return null
  }
  if (!isSkippedHreflangValues(record.skippedHreflangValues)) return null

  return {
    version: record.version,
    generatedAt: record.generatedAt,
    videoRouteGroups: record.videoRouteGroups,
    episodeRouteGroups: record.episodeRouteGroups,
    skippedHreflangValues: record.skippedHreflangValues,
  }
}

export function clearWatchSeoManifestCache(): void {
  manifestCache = {
    etag: null,
    expiresAt: 0,
    inFlight: null,
    manifest: null,
  }
}

export function setWatchSeoManifestSourceForTest(
  source: WatchSeoManifestSource | null,
): () => void {
  const previous = sourceOverride
  sourceOverride = source
  clearWatchSeoManifestCache()
  return () => {
    sourceOverride = previous
    clearWatchSeoManifestCache()
  }
}

function watchSeoManifestUrl(): string | null {
  const adminGraphqlUrl = process.env.ADMIN_GRAPHQL_URL
  if (!adminGraphqlUrl) return null
  try {
    const url = new URL(adminGraphqlUrl)
    url.pathname = url.pathname.replace(/\/api\/graphql\/?$/, "")
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/watch-seo-manifest`
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function watchSeoManifestBearer(): string | null {
  const bearer = process.env.WEB_ADMIN_API_KEYS?.split(",")[0]?.trim()
  return bearer || null
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(WATCH_SEO_MANIFEST_TIMEOUT_MS)
    : undefined
}

async function fetchWatchSeoManifest(): Promise<WatchSeoManifest | null> {
  const url = watchSeoManifestUrl()
  const bearer = watchSeoManifestBearer()
  if (!url || !bearer) return null

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(manifestCache.etag ? { "If-None-Match": manifestCache.etag } : {}),
      },
      cache: "no-store",
      signal: timeoutSignal(),
    })

    if (response.status === 304) {
      return manifestCache.manifest
    }
    if (!response.ok) {
      logWatchServerEvent("watch_seo_manifest.fetch.failed", {
        status: response.status,
        url,
      })
      return manifestCache.manifest
    }

    const parsed = parseWatchSeoManifest(await response.json())
    if (!parsed) {
      logWatchServerEvent("watch_seo_manifest.fetch.invalid_payload", { url })
      return manifestCache.manifest
    }

    manifestCache.etag = response.headers.get("etag")
    return parsed
  } catch (error) {
    logWatchServerEvent("watch_seo_manifest.fetch.error", {
      detail: error instanceof Error ? error : String(error),
      url,
    })
    return manifestCache.manifest
  }
}

export async function getWatchSeoManifest(): Promise<WatchSeoManifest | null> {
  if (sourceOverride) return sourceOverride()

  const now = Date.now()
  if (manifestCache.expiresAt > now) return manifestCache.manifest
  if (manifestCache.inFlight) return manifestCache.inFlight

  manifestCache.inFlight = fetchWatchSeoManifest().then((manifest) => {
    manifestCache.manifest = manifest
    manifestCache.expiresAt =
      Date.now() +
      (manifest
        ? WATCH_SEO_MANIFEST_CACHE_TTL_MS
        : WATCH_SEO_MANIFEST_MISS_CACHE_TTL_MS)
    manifestCache.inFlight = null
    return manifest
  })

  return manifestCache.inFlight
}
