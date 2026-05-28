// Single source of truth for emitting watch URLs. Every <Link href>,
// router.push, redirect target, and share URL inside apps/web flows
// through these builders. Safe to import from client + server: no
// node:-only imports, no next/headers.

import type { Route } from "next"

import { env } from "@/env"

import { LOCALE_RESOLVED_PARAM } from "./locale"
import { appendHtmlSuffix } from "./url-shape"

declare const localeSlugBrand: unique symbol
declare const contentSlugBrand: unique symbol

export type LocaleSlug = string & { readonly [localeSlugBrand]: true }
export type ContentSlug = string & { readonly [contentSlugBrand]: true }

const SLUG_PATTERN = /^[a-z0-9-]+$/

export function asLocaleSlug(value: string): LocaleSlug {
  if (!SLUG_PATTERN.test(value)) {
    throw new Error(`invalid LocaleSlug: ${value}`)
  }
  return value as LocaleSlug
}

export function asContentSlug(value: string): ContentSlug {
  if (!SLUG_PATTERN.test(value)) {
    throw new Error(`invalid ContentSlug: ${value}`)
  }
  return value as ContentSlug
}

// `reason` documents WHY a resync sentinel is set on the URL. Today the
// union has one value — the server-side variant-mismatch resync at
// app/[slug]/[locale]/page.tsx:146. When Phase 3 cookie-pref redirects
// or Phase 4 alias-redirect emitters land, expand this union AND
// serialize the value to a `reason=` query param so the wire carries the
// distinction (a single boolean `_lr=1` can't tell three reasons apart).
export type BuildOptions = {
  t?: number
  autoplay?: boolean
  reason?: "locale-resolved"
}

const ONE_SHOT_TIMESTAMP_PARAM = "t"
const ONE_SHOT_AUTOPLAY_PARAM = "autoplay"

const toRoute = (path: string): Route => path as Route

function withQuery(path: string, opts?: BuildOptions): Route {
  if (!opts) return toRoute(path)
  const params = new URLSearchParams()
  if (opts.t != null) params.set(ONE_SHOT_TIMESTAMP_PARAM, String(opts.t))
  if (opts.autoplay) params.set(ONE_SHOT_AUTOPLAY_PARAM, "1")
  if (opts.reason != null) params.set(LOCALE_RESOLVED_PARAM, "1")
  const qs = params.toString()
  return toRoute(qs ? `${path}?${qs}` : path)
}

export function localizedHomePath(lang: LocaleSlug): Route {
  return withQuery(`/${appendHtmlSuffix(lang)}`)
}

export function watchVideoPath(
  slug: ContentSlug,
  lang: LocaleSlug,
  opts?: BuildOptions,
): Route {
  return withQuery(`/${appendHtmlSuffix(slug)}/${appendHtmlSuffix(lang)}`, opts)
}

export function watchEpisodePath(
  series: ContentSlug,
  episode: ContentSlug,
  lang: LocaleSlug,
  opts?: BuildOptions,
): Route {
  return withQuery(
    `/${appendHtmlSuffix(series)}/${episode}/${appendHtmlSuffix(lang)}`,
    opts,
  )
}

export function videosIndexPath(): Route {
  return toRoute("/videos")
}

export function searchPath(q?: string): Route {
  if (!q) return toRoute("/search")
  const params = new URLSearchParams({ q })
  return toRoute(`/search?${params.toString()}`)
}

// Inverse of the builders. Pages (Phase 2) AND the canonicalizer (Phase 4)
// call this. Single source of truth for URL → params classification so the
// two halves can never silently diverge. `pathname` arrives with the
// basePath already stripped (Next 16 proxy.ts semantics).
export type ParsedWatchPath =
  | { kind: "home" }
  | { kind: "localized-home"; lang: string }
  | { kind: "video"; slug: string; lang: string }
  | { kind: "episode"; series: string; episode: string; lang: string }
  | { kind: "videos" }
  | { kind: "search"; q?: string }
  | { kind: "reserved"; prefix: string }
  | { kind: "unknown"; raw: string }

// Two callers with two shapes: proxy.ts hands us a URLSearchParams from
// NextRequest.nextUrl.searchParams; Next 16 page routes hand us a plain
// Record after awaiting their `searchParams: Promise<...>` prop. Accept both
// here so callers don't repeat conversion ceremony at every site.
export type SearchInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>

function readSearchValue(
  search: SearchInput | undefined,
  key: string,
): string | undefined {
  if (!search) return undefined
  if (search instanceof URLSearchParams) {
    return search.get(key) ?? undefined
  }
  const value = search[key]
  if (Array.isArray(value)) return value[0]
  return value
}

const RESERVED_PREFIXES = new Set([
  "api",
  "_next",
  "assets",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
])

function stripSuffix(segment: string): string {
  return segment.replace(/\.html$/i, "")
}

export function parseWatchPath(
  pathname: string,
  search?: SearchInput,
): ParsedWatchPath {
  if (pathname === "" || pathname === "/") return { kind: "home" }

  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return { kind: "home" }

  const first = segments[0]
  if (RESERVED_PREFIXES.has(first)) {
    return { kind: "reserved", prefix: first }
  }

  if (segments.length === 1) {
    if (first === "videos") return { kind: "videos" }
    if (first === "search") {
      return { kind: "search", q: readSearchValue(search, "q") }
    }
    return { kind: "localized-home", lang: stripSuffix(first) }
  }

  if (segments.length === 2) {
    return {
      kind: "video",
      slug: stripSuffix(segments[0]),
      lang: stripSuffix(segments[1]),
    }
  }

  if (segments.length === 3) {
    return {
      kind: "episode",
      series: stripSuffix(segments[0]),
      episode: segments[1],
      lang: stripSuffix(segments[2]),
    }
  }

  return { kind: "unknown", raw: pathname }
}

// Consolidates SITE_BASE (lib/experience-metadata.ts) and
// PUBLIC_SHARE_FALLBACK_ORIGIN (lib/share.ts). Single source of truth lives
// in env.ts (Zod schema + soft host-allowlist + default). Reading the validated
// env value here keeps the default-of-default consistent across the codebase
// and preserves the boot-time misconfig warning the schema emits.
export const WATCH_CANONICAL_ORIGIN = env.NEXT_PUBLIC_CANONICAL_ORIGIN

export const WATCH_BASE_PATH = "/watch"

export function watchVideoAbsolute(
  slug: ContentSlug,
  lang: LocaleSlug,
): string {
  return `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}${watchVideoPath(slug, lang)}`
}

export function watchEpisodeAbsolute(
  series: ContentSlug,
  episode: ContentSlug,
  lang: LocaleSlug,
): string {
  return `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}${watchEpisodePath(series, episode, lang)}`
}

export function localizedHomeAbsolute(lang: LocaleSlug): string {
  return `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}${localizedHomePath(lang)}`
}
