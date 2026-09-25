import {
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
  asLocaleSlug,
  localizedHomePath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "@/lib/routes"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import type {
  WatchSeoManifest,
  WatchSeoManifestAlternate,
  WatchSeoManifestVideoRouteGroup,
} from "@/lib/watch-seo-manifest"

import {
  DEFAULT_MAX_SITEMAP_BYTES,
  DEFAULT_MAX_SITEMAP_URLS,
} from "./watch-sitemap-limits"

export {
  DEFAULT_MAX_SITEMAP_BYTES,
  DEFAULT_MAX_SITEMAP_URLS,
} from "./watch-sitemap-limits"

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'
const URLSET_OPEN =
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
const URLSET_CLOSE = "</urlset>"
const SITEMAPINDEX_OPEN =
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
const SITEMAPINDEX_CLOSE = "</sitemapindex>"
const ENGLISH_BRITISH_LANGUAGE_SLUG = asLocaleSlug("english-british")
const ENGLISH_BRITISH_HREFLANG = resolveWatchLocaleIdentity(
  ENGLISH_BRITISH_LANGUAGE_SLUG,
).htmlLang

export const WATCH_SITEMAP_INDEX_PATH = "/sitemap.xml"
export const WATCH_SITEMAP_CHUNK_PATH_PREFIX = "/sitemap"

export function watchSitemapXmlHeaders(
  manifestVersion: string,
): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    "Content-Type": "application/xml; charset=utf-8",
    ETag: `"watch-sitemap-${manifestVersion}"`,
  }
}

export type WatchSitemapGenerationErrorCode =
  | "chunk_exceeds_max_bytes"
  | "chunk_exceeds_max_urls"
  | "duplicate_loc"
  | "entry_exceeds_max_bytes"
  | "invalid_max_bytes"
  | "invalid_max_urls"
  | "wrapper_exceeds_max_bytes"

export class WatchSitemapGenerationError extends Error {
  constructor(
    readonly code: WatchSitemapGenerationErrorCode,
    readonly details: { actual?: number; limit?: number } = {},
  ) {
    super(`Watch sitemap generation failed: ${code}`)
    this.name = "WatchSitemapGenerationError"
  }
}

export type WatchSitemapLimits = {
  maxBytes?: number
  maxUrls?: number
}

export type WatchSitemapAlternate = WatchSeoManifestAlternate & {
  href: string
}

export type WatchSitemapEntry = {
  loc: string
  alternates: WatchSitemapAlternate[]
}

export type WatchSitemapChunkEntry = {
  alternatesXml: string
  bytes: number
  loc: string
}

export type WatchSitemapChunk = {
  entries: WatchSitemapChunkEntry[]
  bytes: number
}

type ResolvedSitemapGroup = {
  alternateLinksXml: string
  alternateLinksBytes: number
  /** URLs inside the group's hreflang cluster; each carries the whole cluster. */
  annotatedLocs: string[]
  /**
   * Playable URLs with no Google-valid hreflang. They are emitted as bare
   * `<loc>` entries: attaching the cluster's `<xhtml:link>` set to a URL that
   * is not a member would break reciprocity and make Google discard the
   * cluster's annotations entirely.
   */
  unannotatedLocs: string[]
}

const chunkCache = new WeakMap<WatchSeoManifest, WatchSitemapChunk[]>()

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function absoluteWatchUrl(path: string): string {
  return `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}${path}`
}

function createWatchHomeSitemapEntries(): WatchSitemapEntry[] {
  const defaultHome = absoluteWatchUrl("")
  const britishHome = absoluteWatchUrl(
    localizedHomePath(ENGLISH_BRITISH_LANGUAGE_SLUG),
  )
  const alternates: WatchSitemapAlternate[] = [
    {
      hreflang: "en",
      languageSlug: "english",
      href: defaultHome,
    },
    {
      hreflang: ENGLISH_BRITISH_HREFLANG,
      languageSlug: ENGLISH_BRITISH_LANGUAGE_SLUG,
      href: britishHome,
    },
    {
      hreflang: "x-default",
      languageSlug: "english",
      href: defaultHome,
    },
  ]

  return [
    { loc: defaultHome, alternates },
    { loc: britishHome, alternates },
  ]
}

/**
 * Resolves a content slug once, then hands back a per-language URL builder. The
 * content slug is invariant for a whole route group, and a group now spans every
 * playable language, so validating it per URL is thousands of redundant regex
 * tests per group.
 */
function videoHrefBuilder(
  contentSlug: string,
): (languageSlug: string) => string | null {
  const content = tryAsContentSlug(contentSlug)
  if (!content) return () => null
  return (languageSlug) => {
    const language = tryAsLocaleSlug(languageSlug)
    if (!language) return null
    return absoluteWatchUrl(watchVideoPath(content, language))
  }
}

function renderAlternate(alternate: WatchSitemapAlternate): string {
  return `<xhtml:link rel="alternate" hreflang="${xmlEscape(alternate.hreflang)}" href="${xmlEscape(alternate.href)}" />`
}

function renderEntryXml({
  alternatesXml,
  loc,
}: Pick<WatchSitemapChunkEntry, "alternatesXml" | "loc">): string {
  return `<url><loc>${xmlEscape(loc)}</loc>${alternatesXml}</url>`
}

/**
 * Every language the group has a playable canonical URL for. The hreflang
 * cluster comes first so the URLs that already existed keep their order (and
 * therefore their chunk placement), then the playable long tail. `languageSlugs`
 * is absent on admin snapshots generated before it existed, and the union keeps
 * a cluster member that is somehow missing from it.
 */
function routeGroupLanguageSlugs(
  group: Pick<WatchSeoManifestVideoRouteGroup, "alternates" | "languageSlugs">,
): string[] {
  return [
    ...new Set([
      ...group.alternates.map((alternate) => alternate.languageSlug),
      ...(group.languageSlugs ?? []),
    ]),
  ]
}

function groupEntries(
  group: Pick<WatchSeoManifestVideoRouteGroup, "alternates" | "languageSlugs">,
  hrefForLanguage: (languageSlug: string) => string | null,
): WatchSitemapEntry[] {
  // One href resolution per language, reused for both the canonical URL and the
  // alternate that may point at it.
  const hrefByLanguage = new Map<string, string>()
  const locs: string[] = []
  const seen = new Set<string>()
  for (const languageSlug of routeGroupLanguageSlugs(group)) {
    const href = hrefForLanguage(languageSlug)
    // Two slugs can only collide here through bad manifest data; skipping the
    // repeat keeps it out of the cross-group `duplicate_loc` guard, which would
    // otherwise 503 the whole sitemap.
    if (!href || seen.has(href)) continue
    seen.add(href)
    hrefByLanguage.set(languageSlug, href)
    locs.push(href)
  }

  // Keeps the manifest's hreflang ordering, which is what the cluster's
  // `<xhtml:link>` block serializes.
  const resolvedAlternates = group.alternates
    .map((alternate) => {
      const href = hrefByLanguage.get(alternate.languageSlug)
      return href ? { ...alternate, href } : null
    })
    .filter(
      (alternate): alternate is WatchSitemapAlternate => alternate !== null,
    )
  const clusterHrefs = new Set(
    resolvedAlternates.map((alternate) => alternate.href),
  )

  return locs.map((loc) => ({
    loc,
    alternates: clusterHrefs.has(loc) ? resolvedAlternates : [],
  }))
}

function groupForVideoRoute(
  group: WatchSeoManifestVideoRouteGroup,
  hrefForLanguage: (languageSlug: string) => string | null,
): ResolvedSitemapGroup | null {
  return groupForEntries(groupEntries(group, hrefForLanguage))
}

function groupForEntries(
  entries: WatchSitemapEntry[],
): ResolvedSitemapGroup | null {
  if (!entries.length) return null
  const annotatedLocs: string[] = []
  const unannotatedLocs: string[] = []
  let alternateLinksXml = ""
  for (const entry of entries) {
    if (entry.alternates.length === 0) {
      unannotatedLocs.push(entry.loc)
      continue
    }
    if (!annotatedLocs.length) {
      alternateLinksXml = entry.alternates.map(renderAlternate).join("")
    }
    annotatedLocs.push(entry.loc)
  }
  return {
    alternateLinksXml,
    alternateLinksBytes: Buffer.byteLength(alternateLinksXml, "utf8"),
    annotatedLocs,
    unannotatedLocs,
  }
}

/**
 * Walks a group's URLs in emission order, pairing each with the alternate XML
 * it renders. The cluster's XML string is shared by reference across every
 * annotated URL, so a group costs one serialized alternate block, not one per
 * URL.
 */
function* groupLocEntries(
  group: ResolvedSitemapGroup,
): Generator<{ alternatesXml: string; alternatesBytes: number; loc: string }> {
  for (const loc of group.annotatedLocs) {
    yield {
      alternatesXml: group.alternateLinksXml,
      alternatesBytes: group.alternateLinksBytes,
      loc,
    }
  }
  for (const loc of group.unannotatedLocs) {
    yield { alternatesXml: "", alternatesBytes: 0, loc }
  }
}

function createWatchSitemapGroups(
  manifest: WatchSeoManifest,
): ResolvedSitemapGroup[] {
  const groups: ResolvedSitemapGroup[] = []

  for (const group of manifest.videoRouteGroups) {
    const sitemapGroup = groupForVideoRoute(
      group,
      videoHrefBuilder(group.contentSlug),
    )
    if (sitemapGroup) groups.push(sitemapGroup)
  }

  const homeSitemapGroup = groupForEntries(createWatchHomeSitemapEntries())
  if (homeSitemapGroup) groups.push(homeSitemapGroup)

  return groups
}

export function createWatchSitemapEntries(
  manifest: WatchSeoManifest,
): WatchSitemapEntry[] {
  const entries: WatchSitemapEntry[] = []

  for (const group of manifest.videoRouteGroups) {
    entries.push(...groupEntries(group, videoHrefBuilder(group.contentSlug)))
  }

  entries.push(...createWatchHomeSitemapEntries())

  return entries
}

export function getWatchSitemapChunks(
  manifest: WatchSeoManifest,
  limits: WatchSitemapLimits = {},
): WatchSitemapChunk[] {
  const useDefaultLimits =
    limits.maxBytes === undefined && limits.maxUrls === undefined
  if (useDefaultLimits) {
    const cached = chunkCache.get(manifest)
    if (cached) return cached
  }

  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_SITEMAP_BYTES
  const maxUrls = limits.maxUrls ?? DEFAULT_MAX_SITEMAP_URLS
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new WatchSitemapGenerationError("invalid_max_bytes", {
      actual: maxBytes,
    })
  }
  if (!Number.isSafeInteger(maxUrls) || maxUrls <= 0) {
    throw new WatchSitemapGenerationError("invalid_max_urls", {
      actual: maxUrls,
    })
  }
  const wrapperBytes = Buffer.byteLength(
    `${XML_HEADER}${URLSET_OPEN}${URLSET_CLOSE}`,
    "utf8",
  )
  if (wrapperBytes > maxBytes) {
    throw new WatchSitemapGenerationError("wrapper_exceeds_max_bytes", {
      actual: wrapperBytes,
      limit: maxBytes,
    })
  }
  const chunks: WatchSitemapChunk[] = []
  let current: WatchSitemapChunk = { entries: [], bytes: wrapperBytes }
  const seenLocs = new Set<string>()

  for (const group of createWatchSitemapGroups(manifest)) {
    for (const { alternatesXml, alternatesBytes, loc } of groupLocEntries(
      group,
    )) {
      if (seenLocs.has(loc)) {
        throw new WatchSitemapGenerationError("duplicate_loc")
      }
      seenLocs.add(loc)
      const entry: WatchSitemapChunkEntry = {
        alternatesXml,
        bytes:
          Buffer.byteLength("<url><loc></loc></url>", "utf8") +
          Buffer.byteLength(xmlEscape(loc), "utf8") +
          alternatesBytes,
        loc,
      }
      if (wrapperBytes + entry.bytes > maxBytes) {
        throw new WatchSitemapGenerationError("entry_exceeds_max_bytes", {
          actual: wrapperBytes + entry.bytes,
          limit: maxBytes,
        })
      }
      const wouldExceedUrlLimit = current.entries.length >= maxUrls
      const wouldExceedByteLimit = current.bytes + entry.bytes > maxBytes
      if (wouldExceedUrlLimit || wouldExceedByteLimit) {
        chunks.push(current)
        current = { entries: [], bytes: wrapperBytes }
      }
      current.entries.push(entry)
      current.bytes += entry.bytes
    }
  }

  if (current.entries.length > 0 || chunks.length === 0) {
    chunks.push(current)
  }

  for (const chunk of chunks) {
    if (chunk.bytes > maxBytes) {
      throw new WatchSitemapGenerationError("chunk_exceeds_max_bytes", {
        actual: chunk.bytes,
        limit: maxBytes,
      })
    }
    if (chunk.entries.length > maxUrls) {
      throw new WatchSitemapGenerationError("chunk_exceeds_max_urls", {
        actual: chunk.entries.length,
        limit: maxUrls,
      })
    }
  }

  if (useDefaultLimits) {
    chunkCache.set(manifest, chunks)
  }
  return chunks
}

export function normalizeWatchSitemapChunkId(rawId: string): number | null {
  const id = rawId.replace(/\.xml$/i, "")
  if (!/^\d+$/.test(id)) return null
  const parsed = Number(id)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function watchSitemapChunkPath(id: number): string {
  return `${WATCH_SITEMAP_CHUNK_PATH_PREFIX}/${id}.xml`
}

export function watchSitemapChunkUrl(id: number): string {
  return absoluteWatchUrl(watchSitemapChunkPath(id))
}

export function renderWatchSitemapIndex(
  manifest: WatchSeoManifest,
  limits?: WatchSitemapLimits,
): string {
  const chunks = getWatchSitemapChunks(manifest, limits)
  const entries = chunks
    .map(
      (_chunk, index) =>
        `<sitemap><loc>${xmlEscape(watchSitemapChunkUrl(index))}</loc></sitemap>`,
    )
    .join("")
  return `${XML_HEADER}${SITEMAPINDEX_OPEN}${entries}${SITEMAPINDEX_CLOSE}`
}

export function renderWatchSitemapChunk(
  manifest: WatchSeoManifest,
  id: number,
  limits?: WatchSitemapLimits,
): string | null {
  const chunk = getWatchSitemapChunks(manifest, limits)[id]
  if (!chunk) return null
  return `${XML_HEADER}${URLSET_OPEN}${chunk.entries.map(renderEntryXml).join("")}${URLSET_CLOSE}`
}
