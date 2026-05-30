export type WatchRouteManifest = {
  version: string
  generatedAt: string
  contentSlugs: string[]
  oneSegmentSlugs: string[]
  episodePairsByParent: Record<string, string[]>
  audioLanguageSlugs: string[]
}

export type WatchRouteManifestRoute =
  | { kind: "one-segment"; slug: string }
  | { kind: "video"; contentSlug: string; audioLanguageSlug: string }
  | {
      kind: "episode"
      parentSlug: string
      childSlug: string
      audioLanguageSlug: string
    }

type WatchRouteManifestIndex = {
  contentSlugs: ReadonlySet<string>
  oneSegmentSlugs: ReadonlySet<string>
  episodePairsByParent: ReadonlyMap<string, ReadonlySet<string>>
  audioLanguageSlugs: ReadonlySet<string>
}

type WatchRouteManifestCache = {
  etag: string | null
  expiresAt: number
  inFlight: Promise<WatchRouteManifest | null> | null
  manifest: WatchRouteManifest | null
}

export type WatchRouteManifestSource = () => Promise<WatchRouteManifest | null>

const WATCH_ROUTE_MANIFEST_CACHE_TTL_MS = 60_000
const WATCH_ROUTE_MANIFEST_TIMEOUT_MS = 1_500

let manifestCache: WatchRouteManifestCache = {
  etag: null,
  expiresAt: 0,
  inFlight: null,
  manifest: null,
}
let sourceOverride: WatchRouteManifestSource | null = null

const indexCache = new WeakMap<WatchRouteManifest, WatchRouteManifestIndex>()

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isEpisodePairsByParent(
  value: unknown,
): value is Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([parentSlug, childSlugs]) =>
      typeof parentSlug === "string" && isStringArray(childSlugs),
  )
}

export function parseWatchRouteManifest(
  value: unknown,
): WatchRouteManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.version !== "string" || !record.version) return null
  if (typeof record.generatedAt !== "string" || !record.generatedAt) {
    return null
  }
  if (!isStringArray(record.contentSlugs)) return null
  if (!isStringArray(record.oneSegmentSlugs)) return null
  if (!isEpisodePairsByParent(record.episodePairsByParent)) return null
  if (!isStringArray(record.audioLanguageSlugs)) return null
  return {
    version: record.version,
    generatedAt: record.generatedAt,
    contentSlugs: record.contentSlugs,
    oneSegmentSlugs: record.oneSegmentSlugs,
    episodePairsByParent: record.episodePairsByParent,
    audioLanguageSlugs: record.audioLanguageSlugs,
  }
}

function getManifestIndex(
  manifest: WatchRouteManifest,
): WatchRouteManifestIndex {
  const cached = indexCache.get(manifest)
  if (cached) return cached

  const index: WatchRouteManifestIndex = {
    contentSlugs: new Set(manifest.contentSlugs),
    oneSegmentSlugs: new Set(manifest.oneSegmentSlugs),
    episodePairsByParent: new Map(
      Object.entries(manifest.episodePairsByParent).map(
        ([parentSlug, childSlugs]) =>
          [parentSlug, new Set(childSlugs)] as const,
      ),
    ),
    audioLanguageSlugs: new Set(manifest.audioLanguageSlugs),
  }
  indexCache.set(manifest, index)
  return index
}

export function isWatchRouteAdmittedByManifest(
  manifest: WatchRouteManifest,
  route: WatchRouteManifestRoute,
): boolean {
  const index = getManifestIndex(manifest)
  if (route.kind === "one-segment") {
    return index.oneSegmentSlugs.has(route.slug)
  }
  if (route.kind === "video") {
    return (
      index.contentSlugs.has(route.contentSlug) &&
      index.audioLanguageSlugs.has(route.audioLanguageSlug)
    )
  }
  return (
    index.audioLanguageSlugs.has(route.audioLanguageSlug) &&
    (index.episodePairsByParent.get(route.parentSlug)?.has(route.childSlug) ??
      false)
  )
}

export function clearWatchRouteManifestCache(): void {
  manifestCache = {
    etag: null,
    expiresAt: 0,
    inFlight: null,
    manifest: null,
  }
}

export function setWatchRouteManifestSourceForTest(
  source: WatchRouteManifestSource | null,
): () => void {
  const previous = sourceOverride
  sourceOverride = source
  clearWatchRouteManifestCache()
  return () => {
    sourceOverride = previous
    clearWatchRouteManifestCache()
  }
}

function watchRouteManifestUrl(): string | null {
  const adminGraphqlUrl = process.env.ADMIN_GRAPHQL_URL
  if (!adminGraphqlUrl) return null
  try {
    const url = new URL(adminGraphqlUrl)
    url.pathname = url.pathname.replace(/\/api\/graphql\/?$/, "")
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/watch-route-manifest`
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function watchRouteManifestBearer(): string | null {
  const bearer = process.env.WEB_ADMIN_API_KEYS?.split(",")[0]?.trim()
  return bearer || null
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(WATCH_ROUTE_MANIFEST_TIMEOUT_MS)
    : undefined
}

async function fetchWatchRouteManifest(): Promise<WatchRouteManifest | null> {
  const url = watchRouteManifestUrl()
  const bearer = watchRouteManifestBearer()
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
      console.warn(
        JSON.stringify({
          event: "watch_route_manifest.fetch.failed",
          status: response.status,
        }),
      )
      return manifestCache.manifest
    }

    const parsed = parseWatchRouteManifest(await response.json())
    if (!parsed) {
      console.warn(
        JSON.stringify({
          event: "watch_route_manifest.fetch.invalid_payload",
        }),
      )
      return manifestCache.manifest
    }

    manifestCache.etag = response.headers.get("etag")
    return parsed
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "watch_route_manifest.fetch.error",
        detail:
          error instanceof Error ? error.message.slice(0, 500) : String(error),
      }),
    )
    return manifestCache.manifest
  }
}

export async function getWatchRouteManifest(): Promise<WatchRouteManifest | null> {
  if (sourceOverride) return sourceOverride()

  const now = Date.now()
  if (manifestCache.expiresAt > now) return manifestCache.manifest
  if (manifestCache.inFlight) return manifestCache.inFlight

  manifestCache.inFlight = fetchWatchRouteManifest().then((manifest) => {
    manifestCache.manifest = manifest
    manifestCache.expiresAt = Date.now() + WATCH_ROUTE_MANIFEST_CACHE_TTL_MS
    manifestCache.inFlight = null
    return manifest
  })

  return manifestCache.inFlight
}
