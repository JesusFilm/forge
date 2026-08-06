// Single source of truth for emitting watch URLs. Every <Link href>,
// router.push, redirect target, and share URL inside apps/web flows
// through these builders. Safe to import from client + server: no
// node:-only imports, no next/headers.

import type { Route } from "next"

import {
  buildCanonicalWatchVideoPath,
  buildExplicitWatchVideoPath,
} from "@forge/watch-url-policy/routes"

import { env } from "@/env"

import { LOCALE_RESOLVED_PARAM } from "./locale"
import {
  RESERVED_PREFIXES,
  appendHtmlSuffix,
  stripHtmlSuffix,
} from "./url-shape"

declare const localeSlugBrand: unique symbol
declare const contentSlugBrand: unique symbol

/** English-name kebab-case language identifier (e.g. `english`, `russian`, `portuguese-brazil`). NOT a bcp47 code. */
export type LocaleSlug = string & { readonly [localeSlugBrand]: true }

/** Watch-content URL segment (e.g. `jesus`, `soccer_event_collection`). Lowercase ASCII slug shape. */
export type ContentSlug = string & { readonly [contentSlugBrand]: true }

const LOCALE_SLUG_PATTERN = /^[a-z0-9-]+$/
const CONTENT_SLUG_PATTERN = /^[a-z0-9_-]+$/

/** Throw-on-invalid `LocaleSlug` constructor. Use for pre-validated inputs (env vars, configured constants). Prefer `tryAsLocaleSlug` at user-input boundaries. */
export function asLocaleSlug(value: string): LocaleSlug {
  if (!LOCALE_SLUG_PATTERN.test(value)) {
    throw new Error(`invalid LocaleSlug: ${value}`)
  }
  return value as LocaleSlug
}

/** Throw-on-invalid `ContentSlug` constructor. Use for pre-validated inputs. Prefer `tryAsContentSlug` at user-input boundaries. */
export function asContentSlug(value: string): ContentSlug {
  if (!CONTENT_SLUG_PATTERN.test(value)) {
    throw new Error(`invalid ContentSlug: ${value}`)
  }
  return value as ContentSlug
}

/** Result-shape `LocaleSlug` constructor. Returns `null` if the input fails the slug regex — for use at page routes / agent boundaries where invalid input should `notFound()` instead of crash. */
export function tryAsLocaleSlug(value: string): LocaleSlug | null {
  return LOCALE_SLUG_PATTERN.test(value) ? (value as LocaleSlug) : null
}

/** Result-shape `ContentSlug` constructor. Returns `null` on invalid input. */
export function tryAsContentSlug(value: string): ContentSlug | null {
  return CONTENT_SLUG_PATTERN.test(value) ? (value as ContentSlug) : null
}

// `reason` documents WHY a resync sentinel is set on the URL. Today the
// union has one value — the server-side variant-mismatch resync in
// app/[locale]/[htmlLang]/[...rest]/page.tsx. When future redirect emitters
// land, expand this union AND serialize the value to a `reason=` query param
// so the wire carries the distinction (a single boolean `_lr=1` can't tell
// three reasons apart).
export type BuildOptions = {
  t?: number
  autoplay?: boolean
  reason?: "locale-resolved"
  subtitleLanguage?: LocaleSlug
}

const ONE_SHOT_TIMESTAMP_PARAM = "t"
const ONE_SHOT_AUTOPLAY_PARAM = "autoplay"
export const SUBTITLE_INTENT_PARAM = "subtitles"
export const WATCH_SUBTITLE_INTENT_SEGMENT_PREFIX = "__subtitle-"

export function watchSubtitleIntentSegment(lang: LocaleSlug): string {
  return `${WATCH_SUBTITLE_INTENT_SEGMENT_PREFIX}${lang}`
}

export function parseWatchSubtitleIntentSegment(
  segment: string,
): LocaleSlug | null {
  if (!segment.startsWith(WATCH_SUBTITLE_INTENT_SEGMENT_PREFIX)) return null
  return tryAsLocaleSlug(
    segment.slice(WATCH_SUBTITLE_INTENT_SEGMENT_PREFIX.length),
  )
}

/**
 * Per-builder template-literal Route shapes. typedRoutes validates `<Link href>`
 * against the file tree, which can't capture our `.html`-in-segment literals;
 * these narrower types give each builder a structural shape so the cast at
 * the builder boundary is type-narrowing instead of type-laundering.
 */
type LocalizedHomeRoute = `/${string}.html${"" | `?${string}`}`
type LanguageInventoryRoute = `/${string}.html/videos`
type WatchVideoPathname = `/${string}.html` | `/${string}.html/${string}.html`
type WatchVideoRoute = `${WatchVideoPathname}${"" | `?${string}`}`
type WatchVideoExplicitLanguageRoute =
  `/${string}.html/${string}.html${"" | `?${string}`}`
type WatchEpisodeRoute =
  `/${string}.html/${string}/${string}.html${"" | `?${string}`}`
type LanguagesIndexRoute = "/languages"
type LanguageVideosIndexRoute = `/${string}.html/videos`
type LocalizedLanguagesRoute = `/${string}.html/languages`
type LocalizedHistoryRoute = `/${string}.html/history`
type SearchRoute = "/"

function appendQueryString(path: string, opts?: BuildOptions): string {
  if (!opts) return path
  const params = new URLSearchParams()
  if (opts.t != null) params.set(ONE_SHOT_TIMESTAMP_PARAM, String(opts.t))
  if (opts.autoplay) params.set(ONE_SHOT_AUTOPLAY_PARAM, "1")
  if (opts.reason != null) params.set(LOCALE_RESOLVED_PARAM, "1")
  if (opts.subtitleLanguage != null) {
    params.set(SUBTITLE_INTENT_PARAM, opts.subtitleLanguage)
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** Build the localized home path `/{lang}.html` (e.g. `/russian.html`). */
export function localizedHomePath(
  lang: LocaleSlug,
): LocalizedHomeRoute & Route {
  const path = `/${appendHtmlSuffix(lang)}`
  return appendQueryString(path) as LocalizedHomeRoute & Route
}

/** Build a localized inventory path `/{lang}.html/videos` (e.g. `/spanish-latin-american.html/videos`). */
export function languageInventoryPath(
  lang: LocaleSlug,
): LanguageInventoryRoute & Route {
  return `/${appendHtmlSuffix(lang)}/videos` as LanguageInventoryRoute & Route
}

/**
 * Build the canonical standalone watch path. Eligible English content uses
 * `/{slug}.html`; non-English and one-segment collisions keep
 * `/{slug}.html/{lang}.html`.
 */
export function watchVideoPath(
  slug: ContentSlug,
  lang: LocaleSlug,
  opts?: BuildOptions,
): WatchVideoRoute & Route {
  const path = buildCanonicalWatchVideoPath(slug, lang)
  return appendQueryString(path, opts) as WatchVideoRoute & Route
}

/** Build the explicit `/{slug}.html/{lang}.html` compatibility/internal path. */
export function watchVideoExplicitLanguagePath(
  slug: ContentSlug,
  lang: LocaleSlug,
  opts?: BuildOptions,
): WatchVideoExplicitLanguageRoute & Route {
  const path = buildExplicitWatchVideoPath(slug, lang)
  return appendQueryString(path, opts) as WatchVideoExplicitLanguageRoute &
    Route
}

/** Build the three-segment series-episode path `/{series}.html/{episode}/{lang}.html` (episode segment is bare by production contract). */
export function watchEpisodePath(
  series: ContentSlug,
  episode: ContentSlug,
  lang: LocaleSlug,
  opts?: BuildOptions,
): WatchEpisodeRoute & Route {
  const path = `/${appendHtmlSuffix(series)}/${episode}/${appendHtmlSuffix(lang)}`
  return appendQueryString(path, opts) as WatchEpisodeRoute & Route
}

/** Build the all-languages index path `/languages` (no `.html` suffix). */
export function languagesIndexPath(): LanguagesIndexRoute & Route {
  return "/languages" as LanguagesIndexRoute & Route
}

/** Build the language-bearing all-languages path `/{lang}.html/languages`. */
export function localizedLanguagesPath(
  lang: LocaleSlug,
): LocalizedLanguagesRoute & Route {
  return `/${appendHtmlSuffix(lang)}/languages` as LocalizedLanguagesRoute &
    Route
}

/** Build the language-bearing history path `/{lang}.html/history`. */
export function localizedHistoryPath(
  lang: LocaleSlug,
): LocalizedHistoryRoute & Route {
  return `/${appendHtmlSuffix(lang)}/history` as LocalizedHistoryRoute & Route
}

/** @deprecated Use `languagesIndexPath()` for the canonical language index. */
export function videosIndexPath(): LanguagesIndexRoute & Route {
  return languagesIndexPath()
}

/** Build the language-scoped videos index path `/{lang}.html/videos`. */
export function languageVideosIndexPath(
  lang: LocaleSlug,
): LanguageVideosIndexRoute & Route {
  return `/${appendHtmlSuffix(lang)}/videos` as LanguageVideosIndexRoute & Route
}

/** Build the global search-modal fallback path `/`. */
export function searchPath(): SearchRoute & Route {
  return "/" as SearchRoute & Route
}

/**
 * Discriminated union returned by `parseWatchPath`. Twelve kinds:
 *
 * - `home` — `/` (English default home)
 * - `localized-home` — `/{lang}.html` (one segment)
 * - `video` — `/{slug}.html/{lang}.html` (two segments)
 * - `episode` — `/{series}.html/{episode}/{lang}.html` (three segments)
 * - `languages` — `/languages`
 * - `localized-languages` — `/{lang}.html/languages`
 * - `history` — `/history`
 * - `localized-history` — `/{lang}.html/history`
 * - `language-videos` — `/{lang}.html/videos`
 * - `search` — deprecated inbound `/search` redirect shim
 * - `reserved` — first segment is in `RESERVED_PREFIXES` (api, _next, assets, etc.)
 * - `unknown` — none of the above (four-or-more segments, malformed)
 */
export type ParsedWatchPath =
  | { kind: "home" }
  | { kind: "localized-home"; lang: string }
  | { kind: "video"; slug: string; lang: string }
  | { kind: "episode"; series: string; episode: string; lang: string }
  | { kind: "languages" }
  | { kind: "localized-languages"; lang: string }
  | { kind: "history" }
  | { kind: "localized-history"; lang: string }
  | { kind: "language-videos"; lang: string }
  | { kind: "search" }
  | { kind: "reserved"; prefix: string }
  | { kind: "unknown"; raw: string }

/**
 * Classify a watch pathname (basePath-stripped) into a `ParsedWatchPath`.
 * Single source of truth — both page routes (Phase 2) and the canonicalizer
 * read this so the two halves can never silently drift.
 */
export function parseWatchPath(pathname: string): ParsedWatchPath {
  if (pathname === "" || pathname === "/") return { kind: "home" }

  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return { kind: "home" }

  const first = segments[0]
  if (RESERVED_PREFIXES.has(first)) {
    return { kind: "reserved", prefix: first }
  }

  if (segments.length === 1) {
    if (first === "languages" || first === "videos") {
      return { kind: "languages" }
    }
    if (first === "history") return { kind: "history" }
    if (first === "search") return { kind: "search" }
    return { kind: "localized-home", lang: stripHtmlSuffix(first) }
  }

  if (segments.length === 2) {
    if (segments[1] === "languages") {
      return {
        kind: "localized-languages",
        lang: stripHtmlSuffix(segments[0]),
      }
    }
    if (segments[1] === "history") {
      return {
        kind: "localized-history",
        lang: stripHtmlSuffix(segments[0]),
      }
    }
    if (segments[1] === "videos") {
      return {
        kind: "language-videos",
        lang: stripHtmlSuffix(segments[0]),
      }
    }

    return {
      kind: "video",
      slug: stripHtmlSuffix(segments[0]),
      lang: stripHtmlSuffix(segments[1]),
    }
  }

  if (segments.length === 3) {
    return {
      kind: "episode",
      series: stripHtmlSuffix(segments[0]),
      episode: segments[1],
      lang: stripHtmlSuffix(segments[2]),
    }
  }

  return { kind: "unknown", raw: pathname }
}

// Environment-specific absolute origin for app-local absolute URL builders.
// Single source of truth lives in env.ts (Zod schema + soft host-allowlist +
// default). Public Share and SEO/social metadata resolve through
// WATCH_PUBLIC_METADATA_ORIGIN when the configured origin is not public.
export const WATCH_CANONICAL_ORIGIN = env.NEXT_PUBLIC_CANONICAL_ORIGIN

// The indexed public website host used by SEO/social metadata and as the Share
// fallback for local/private app origins.
export const WATCH_PUBLIC_METADATA_ORIGIN = "https://www.jesusfilm.org"

// Re-exported from the shared watch-base-path.mjs module that
// next.config.mjs also imports. Single source of truth so a basePath
// change in next.config can't desync from the URL builders here.
import { WATCH_BASE_PATH } from "../../watch-base-path.mjs"
export { WATCH_BASE_PATH }

/** Build an environment-specific absolute URL for a canonical watch video. */
export function watchVideoAbsolute(
  slug: ContentSlug,
  lang: LocaleSlug,
): string {
  return `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}${watchVideoPath(slug, lang)}`
}

/** Build an environment-specific absolute URL for a series episode (origin + basePath + 3-segment path). */
export function watchEpisodeAbsolute(
  series: ContentSlug,
  episode: ContentSlug,
  lang: LocaleSlug,
): string {
  return `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}${watchEpisodePath(series, episode, lang)}`
}

/** Build an environment-specific absolute URL for a localized home (origin + basePath + 1-segment path). */
export function localizedHomeAbsolute(lang: LocaleSlug): string {
  return `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}${localizedHomePath(lang)}`
}
