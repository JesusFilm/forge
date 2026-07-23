import {
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
  asLocaleSlug,
  localizedHomePath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import type {
  WatchSeoManifest,
  WatchSeoManifestAlternate,
} from "@/lib/watch-seo-manifest"

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
export const DEFAULT_MAX_SITEMAP_URLS = 50_000
export const DEFAULT_MAX_SITEMAP_BYTES = 45_000_000

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
  locs: string[]
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

function videoHref(contentSlug: string, languageSlug: string): string | null {
  const content = tryAsContentSlug(contentSlug)
  const language = tryAsLocaleSlug(languageSlug)
  if (!content || !language) return null
  return absoluteWatchUrl(watchVideoPath(content, language))
}

function episodeHref(
  parentSlug: string,
  childSlug: string,
  languageSlug: string,
): string | null {
  const parent = tryAsContentSlug(parentSlug)
  const child = tryAsContentSlug(childSlug)
  const language = tryAsLocaleSlug(languageSlug)
  if (!parent || !child || !language) return null
  return absoluteWatchUrl(watchEpisodePath(parent, child, language))
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

function groupEntries(
  alternates: WatchSeoManifestAlternate[],
  hrefForLanguage: (languageSlug: string) => string | null,
): WatchSitemapEntry[] {
  const resolvedAlternates = alternates
    .map((alternate) => {
      const href = hrefForLanguage(alternate.languageSlug)
      return href ? { ...alternate, href } : null
    })
    .filter(
      (alternate): alternate is WatchSitemapAlternate => alternate !== null,
    )

  return resolvedAlternates.map((alternate) => ({
    loc: alternate.href,
    alternates: resolvedAlternates,
  }))
}

function groupForAlternates(
  alternates: WatchSeoManifestAlternate[],
  hrefForLanguage: (languageSlug: string) => string | null,
): ResolvedSitemapGroup | null {
  return groupForEntries(groupEntries(alternates, hrefForLanguage))
}

function groupForEntries(
  entries: WatchSitemapEntry[],
): ResolvedSitemapGroup | null {
  if (!entries.length) return null
  const alternateLinksXml = entries[0]?.alternates.map(renderAlternate).join("")
  if (!alternateLinksXml) return null
  return {
    alternateLinksXml,
    alternateLinksBytes: Buffer.byteLength(alternateLinksXml, "utf8"),
    locs: entries.map((entry) => entry.loc),
  }
}

function createWatchSitemapGroups(
  manifest: WatchSeoManifest,
): ResolvedSitemapGroup[] {
  const groups: ResolvedSitemapGroup[] = []

  for (const group of manifest.videoRouteGroups) {
    const sitemapGroup = groupForAlternates(group.alternates, (languageSlug) =>
      videoHref(group.contentSlug, languageSlug),
    )
    if (sitemapGroup) groups.push(sitemapGroup)
  }

  for (const group of manifest.episodeRouteGroups) {
    const sitemapGroup = groupForAlternates(group.alternates, (languageSlug) =>
      episodeHref(group.parentSlug, group.childSlug, languageSlug),
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
    entries.push(
      ...groupEntries(group.alternates, (languageSlug) =>
        videoHref(group.contentSlug, languageSlug),
      ),
    )
  }

  for (const group of manifest.episodeRouteGroups) {
    entries.push(
      ...groupEntries(group.alternates, (languageSlug) =>
        episodeHref(group.parentSlug, group.childSlug, languageSlug),
      ),
    )
  }

  entries.push(...createWatchHomeSitemapEntries())

  return entries
}

export function getWatchSitemapChunks(
  manifest: WatchSeoManifest,
  limits: WatchSitemapLimits = {},
): WatchSitemapChunk[] {
  if (!limits.maxBytes && !limits.maxUrls) {
    const cached = chunkCache.get(manifest)
    if (cached) return cached
  }

  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_SITEMAP_BYTES
  const maxUrls = limits.maxUrls ?? DEFAULT_MAX_SITEMAP_URLS
  const wrapperBytes = Buffer.byteLength(
    `${XML_HEADER}${URLSET_OPEN}${URLSET_CLOSE}`,
    "utf8",
  )
  const chunks: WatchSitemapChunk[] = []
  let current: WatchSitemapChunk = { entries: [], bytes: wrapperBytes }

  for (const group of createWatchSitemapGroups(manifest)) {
    for (const loc of group.locs) {
      const entry: WatchSitemapChunkEntry = {
        alternatesXml: group.alternateLinksXml,
        bytes:
          Buffer.byteLength("<url><loc></loc></url>", "utf8") +
          Buffer.byteLength(xmlEscape(loc), "utf8") +
          group.alternateLinksBytes,
        loc,
      }
      const wouldExceedUrlLimit = current.entries.length >= maxUrls
      const wouldExceedByteLimit =
        current.entries.length > 0 && current.bytes + entry.bytes > maxBytes
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

  if (!limits.maxBytes && !limits.maxUrls) {
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
