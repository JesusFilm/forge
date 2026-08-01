import { logWatchServerEvent } from "./watch-observability"

export type WatchRouteManifest = {
  version: string
  generatedAt: string
  contentSlugs: string[]
  oneSegmentSlugs: string[]
  homepageLocales?: string[]
  episodePairsByParent: Record<string, string[]>
  audioLanguageSlugs: string[]
  audioLanguageIndexesByContent?: Record<string, number[]>
  audioLanguageIndexesByEpisode?: Record<string, Record<string, number[]>>
  nestedContainerAudioLanguageIndexesByParent?: Record<
    string,
    Record<string, number[]>
  >
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

type WatchEpisodeManifestRoute = Extract<
  WatchRouteManifestRoute,
  { kind: "episode" }
>

type WatchRouteManifestIndex = {
  contentSlugs: ReadonlySet<string>
  oneSegmentSlugs: ReadonlySet<string>
  episodePairsByParent: ReadonlyMap<string, ReadonlySet<string>>
  audioLanguageSlugs: ReadonlySet<string>
  audioLanguageSlugsByContent: ReadonlyMap<string, ReadonlySet<string>>
  audioLanguageSlugsByEpisode: ReadonlyMap<
    string,
    ReadonlyMap<string, ReadonlySet<string>>
  >
  nestedContainerAudioLanguageSlugsByParent: ReadonlyMap<
    string,
    ReadonlyMap<string, ReadonlySet<string>>
  >
  hasContentAudioLanguageIndex: boolean
  hasEpisodeAudioLanguageIndex: boolean
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

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => Number.isInteger(item) && item >= 0)
  )
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

function isAudioLanguageIndexesByContent(
  value: unknown,
): value is Record<string, number[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([contentSlug, audioLanguageIndexes]) =>
      typeof contentSlug === "string" && isNumberArray(audioLanguageIndexes),
  )
}

function isAudioLanguageIndexesByEpisode(
  value: unknown,
): value is Record<string, Record<string, number[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([parentSlug, children]) =>
      typeof parentSlug === "string" &&
      isAudioLanguageIndexesByContent(children),
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
  if (
    record.homepageLocales !== undefined &&
    !isStringArray(record.homepageLocales)
  ) {
    return null
  }
  if (!isEpisodePairsByParent(record.episodePairsByParent)) return null
  if (!isStringArray(record.audioLanguageSlugs)) return null
  if (
    record.audioLanguageIndexesByContent !== undefined &&
    !isAudioLanguageIndexesByContent(record.audioLanguageIndexesByContent)
  ) {
    return null
  }
  if (
    record.audioLanguageIndexesByEpisode !== undefined &&
    !isAudioLanguageIndexesByEpisode(record.audioLanguageIndexesByEpisode)
  ) {
    return null
  }
  if (
    record.nestedContainerAudioLanguageIndexesByParent !== undefined &&
    !isAudioLanguageIndexesByEpisode(
      record.nestedContainerAudioLanguageIndexesByParent,
    )
  ) {
    return null
  }
  return {
    version: record.version,
    generatedAt: record.generatedAt,
    contentSlugs: record.contentSlugs,
    oneSegmentSlugs: record.oneSegmentSlugs,
    ...(record.homepageLocales
      ? { homepageLocales: record.homepageLocales }
      : {}),
    episodePairsByParent: record.episodePairsByParent,
    audioLanguageSlugs: record.audioLanguageSlugs,
    ...(record.audioLanguageIndexesByContent
      ? { audioLanguageIndexesByContent: record.audioLanguageIndexesByContent }
      : {}),
    ...(record.audioLanguageIndexesByEpisode
      ? { audioLanguageIndexesByEpisode: record.audioLanguageIndexesByEpisode }
      : {}),
    ...(record.nestedContainerAudioLanguageIndexesByParent
      ? {
          nestedContainerAudioLanguageIndexesByParent:
            record.nestedContainerAudioLanguageIndexesByParent,
        }
      : {}),
  }
}

function audioLanguageSetFromIndexes(
  audioLanguageIndexes: readonly number[],
  audioLanguageSlugs: readonly string[],
): ReadonlySet<string> {
  const slugs = new Set<string>()
  for (const index of audioLanguageIndexes) {
    const slug = audioLanguageSlugs[index]
    if (slug) slugs.add(slug)
  }
  return slugs
}

function audioLanguageSlugsByParentAndChild(
  indexesByParent: Record<string, Record<string, number[]>>,
  audioLanguageSlugs: readonly string[],
): ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>> {
  return new Map(
    Object.entries(indexesByParent).map(([parentSlug, childEntries]) => [
      parentSlug,
      new Map(
        Object.entries(childEntries).map(
          ([childSlug, audioLanguageIndexes]) =>
            [
              childSlug,
              audioLanguageSetFromIndexes(
                audioLanguageIndexes,
                audioLanguageSlugs,
              ),
            ] as const,
        ),
      ),
    ]),
  )
}

function getManifestIndex(
  manifest: WatchRouteManifest,
): WatchRouteManifestIndex {
  const cached = indexCache.get(manifest)
  if (cached) return cached

  const audioLanguageSlugsByContent = new Map(
    Object.entries(manifest.audioLanguageIndexesByContent ?? {}).map(
      ([contentSlug, audioLanguageIndexes]) =>
        [
          contentSlug,
          audioLanguageSetFromIndexes(
            audioLanguageIndexes,
            manifest.audioLanguageSlugs,
          ),
        ] as const,
    ),
  )
  const audioLanguageSlugsByEpisode = audioLanguageSlugsByParentAndChild(
    manifest.audioLanguageIndexesByEpisode ?? {},
    manifest.audioLanguageSlugs,
  )
  const nestedContainerAudioLanguageSlugsByParent =
    audioLanguageSlugsByParentAndChild(
      manifest.nestedContainerAudioLanguageIndexesByParent ?? {},
      manifest.audioLanguageSlugs,
    )

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
    audioLanguageSlugsByContent,
    audioLanguageSlugsByEpisode,
    nestedContainerAudioLanguageSlugsByParent,
    hasContentAudioLanguageIndex: audioLanguageSlugsByContent.size > 0,
    hasEpisodeAudioLanguageIndex: audioLanguageSlugsByEpisode.size > 0,
  }
  indexCache.set(manifest, index)
  return index
}

function isContentAudioLanguageAdmitted(
  index: WatchRouteManifestIndex,
  contentSlug: string,
  audioLanguageSlug: string,
): boolean {
  const exactLanguages = index.audioLanguageSlugsByContent.get(contentSlug)
  if (exactLanguages) return exactLanguages.has(audioLanguageSlug)
  return index.audioLanguageSlugs.has(audioLanguageSlug)
}

function isEpisodeAudioLanguageAdmitted(
  index: WatchRouteManifestIndex,
  parentSlug: string,
  childSlug: string,
  audioLanguageSlug: string,
): boolean {
  const exactLanguages = index.audioLanguageSlugsByEpisode
    .get(parentSlug)
    ?.get(childSlug)
  if (exactLanguages) return exactLanguages.has(audioLanguageSlug)
  if (index.hasEpisodeAudioLanguageIndex) return false
  return index.audioLanguageSlugs.has(audioLanguageSlug)
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
      isContentAudioLanguageAdmitted(
        index,
        route.contentSlug,
        route.audioLanguageSlug,
      )
    )
  }
  return (
    (index.episodePairsByParent.get(route.parentSlug)?.has(route.childSlug) ??
      false) &&
    isEpisodeAudioLanguageAdmitted(
      index,
      route.parentSlug,
      route.childSlug,
      route.audioLanguageSlug,
    )
  )
}

/** Whether the manifest proves the exact parent-child relationship. */
export function isWatchEpisodePairAdmittedByManifest(
  manifest: WatchRouteManifest,
  route: WatchEpisodeManifestRoute,
): boolean {
  return (
    getManifestIndex(manifest)
      .episodePairsByParent.get(route.parentSlug)
      ?.has(route.childSlug) ?? false
  )
}

/**
 * Whether the manifest's per-episode audio index explicitly proves this route.
 * Unlike the compatibility admission helper, this never falls back to the
 * global audio-language corpus when an older manifest lacks exact indexes.
 */
export function isWatchEpisodeRouteExactlyAdmittedByManifest(
  manifest: WatchRouteManifest,
  route: WatchEpisodeManifestRoute,
): boolean {
  if (!isWatchEpisodePairAdmittedByManifest(manifest, route)) return false
  return (
    getManifestIndex(manifest)
      .audioLanguageSlugsByEpisode.get(route.parentSlug)
      ?.get(route.childSlug)
      ?.has(route.audioLanguageSlug) ?? false
  )
}

export function isWatchNestedContainerRouteAdmittedByManifest(
  manifest: WatchRouteManifest,
  route: {
    parentSlug: string
    childSlug: string
    audioLanguageSlug: string
  },
): boolean {
  return getWatchNestedContainerAudioLanguageSlugs(
    manifest,
    route.parentSlug,
    route.childSlug,
  ).includes(route.audioLanguageSlug)
}

export function getWatchNestedContainerAudioLanguageSlugs(
  manifest: WatchRouteManifest,
  parentSlug: string,
  childSlug: string,
): readonly string[] {
  const index = getManifestIndex(manifest)
  if (
    !index.contentSlugs.has(parentSlug) ||
    !index.contentSlugs.has(childSlug)
  ) {
    return []
  }
  const exactLanguages = index.nestedContainerAudioLanguageSlugsByParent
    .get(parentSlug)
    ?.get(childSlug)
  if (exactLanguages) return [...exactLanguages]
  return []
}

export function isWatchParentAdmittedByNestedContainer(
  manifest: WatchRouteManifest,
  parentSlug: string,
  audioLanguageSlug: string,
): boolean {
  const index = getManifestIndex(manifest)
  if (!index.contentSlugs.has(parentSlug)) return false
  for (const [
    childSlug,
    languages,
  ] of index.nestedContainerAudioLanguageSlugsByParent
    .get(parentSlug)
    ?.entries() ?? []) {
    if (index.contentSlugs.has(childSlug) && languages.has(audioLanguageSlug)) {
      return true
    }
  }
  return false
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
      logWatchServerEvent("watch_route_manifest.fetch.failed", {
        status: response.status,
        url,
      })
      return manifestCache.manifest
    }

    const parsed = parseWatchRouteManifest(await response.json())
    if (!parsed) {
      logWatchServerEvent("watch_route_manifest.fetch.invalid_payload", { url })
      return manifestCache.manifest
    }

    manifestCache.etag = response.headers.get("etag")
    return parsed
  } catch (error) {
    logWatchServerEvent("watch_route_manifest.fetch.error", {
      detail: error instanceof Error ? error : String(error),
      url,
    })
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
