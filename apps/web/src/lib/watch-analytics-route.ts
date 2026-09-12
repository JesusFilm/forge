// Pure analytics projection of the Watch URL space. Page views and every
// custom Watch event resolve their route identity here so no feature
// component rebuilds path logic (R1, R10).
//
// This module is a PROJECTION, never a second route policy (KTD1). Route
// eligibility, alias resolution, and canonical path shapes all come from
// `./routes` + `@forge/watch-url-policy`. The only things added here are
// analytics classifications (route type/variant, language class, entry
// intent) and the privacy bounding R19-R21 require before a value may reach
// Google Analytics.
//
// Pure and client-safe by construction: no `next/headers`, no `server-only`,
// no fetch, no manifest lookup, no module-level mutable state.

import { DEFAULT_WATCH_LANGUAGE_SLUG } from "@forge/watch-url-policy/routes"

import { tryResolveLanguageAlias } from "./language-aliases"
import { LOCALE_RESOLVED_PARAM, isPublicWatchLanguageSlug } from "./locale"
import {
  type ContentSlug,
  type LocaleSlug,
  type ParsedWatchPath,
  SUBTITLE_INTENT_PARAM,
  asLocaleSlug,
  WATCH_BASE_PATH,
  WATCH_CANONICAL_ORIGIN,
  languageVideosIndexPath,
  languagesIndexPath,
  localizedHistoryPath,
  localizedHomePath,
  localizedLanguagesPath,
  parseWatchPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
  whatsNewPath,
} from "./routes"
import { hasHtmlSuffix } from "./url-shape"

/**
 * Finite route families for `watch_route_type` (R5, R20).
 *
 * `video` covers every content page — standalone AND series-episode URLs —
 * because R4 attributes an episode to its standalone canonical identity. The
 * entry form stays visible through `routeVariant: "contextual"`, so the two
 * dimensions never encode the same fact twice.
 *
 * There is deliberately no `unavailable` member. The language-gap
 * "unavailable" experience is served by an INTERNAL rewrite
 * (`WATCH_UNAVAILABLE_SENTINEL_PATH` in `apps/web/src/proxy.ts`); the browser
 * URL stays the explicit `/{slug}.html/{lang}.html` video form, so a resolver
 * that only sees a pathname classifies it as `video`. Minting an
 * `unavailable` value no browser pathname can produce would be a guess, which
 * R5 forbids.
 */
export type WatchAnalyticsRouteType =
  | "home"
  | "language_home"
  | "video"
  | "language_inventory"
  | "languages"
  | "history"
  | "whats_new"
  | "search"
  | "preview"
  | "reserved"
  | "unknown"

/**
 * Finite relationship between the committed browser path and the canonical
 * Watch path for the same identity (R2-R4, R20).
 *
 * - `canonical` — the browser path already equals the canonical path.
 * - `explicit_language_compatibility` — `/{slug}.html/english.html`, which
 *   canonicalizes to `/{slug}.html`.
 * - `language_alias_compatibility` — the language segment is a legacy alias
 *   resolved through `tryResolveLanguageAlias` (never an analytics-only list).
 * - `contextual` — a series-episode URL projected onto standalone identity.
 * - `non_canonical` — any other divergence (e.g. the legacy `/videos` index).
 * - `not_applicable` — routes with no canonical content identity (reserved,
 *   preview, unknown).
 *
 * Precedence when several could apply: `canonical` > `contextual` >
 * `language_alias_compatibility` > `explicit_language_compatibility` >
 * `non_canonical`. Structural entry form outranks language form because an
 * episode URL's language is already reported by `languageClass`.
 */
export type WatchAnalyticsRouteVariant =
  | "canonical"
  | "explicit_language_compatibility"
  | "language_alias_compatibility"
  | "contextual"
  | "non_canonical"
  | "not_applicable"

/**
 * Language class for `watch_language_class` (R20). Deliberately three values:
 * the English default vs. anything else vs. a route that expresses no
 * language at all. The exact slug is separate, payload-only detail (R21).
 *
 * `/watch` (the bare home) is `none`: its rendered language comes from cookie
 * and header negotiation, which a pathname cannot observe.
 */
export type WatchAnalyticsLanguageClass = "english" | "non_english" | "none"

/**
 * What the committed URL asked for beyond the page itself (R1, R20).
 *
 * Precedence: `locale_resolved` > `campaign` > `deep_link_timestamp` >
 * `subtitle_intent` > `autoplay` > `direct`. `locale_resolved` wins because
 * that commit was produced by our own canonicalizing redirect rather than by
 * a visitor, and counting it as a campaign arrival would double-count one
 * visit; the campaign parameters themselves survive in `page_location`.
 */
export type WatchAnalyticsEntryIntent =
  | "direct"
  | "campaign"
  | "locale_resolved"
  | "deep_link_timestamp"
  | "subtitle_intent"
  | "autoplay"

/** Sanitized campaign attribution retained for `page_location` (R7). */
export type WatchAnalyticsCampaign = Readonly<Record<string, string>>

export type WatchAnalyticsRouteInput = {
  /** Browser pathname, with or without the `/watch` basePath. */
  pathname: string
  /** Committed query string. Accepts `location.search`, a `URLSearchParams`, or nothing. */
  search?: string | URLSearchParams | null
}

export type WatchAnalyticsRouteContext = {
  routeType: WatchAnalyticsRouteType
  routeVariant: WatchAnalyticsRouteVariant
  languageClass: WatchAnalyticsLanguageClass
  entryIntent: WatchAnalyticsEntryIntent
  /** Canonical, query-free, basePath-prefixed path for the GA standard `page_path` (R2, R7). */
  canonicalPath: string
  /** Canonical origin + canonical path + sanitized campaign query, for `page_location` (R7). */
  canonicalLocation: string
  /**
   * The committed browser path, bounded and sentinel-checked (R19, R21).
   * OMITTED — never truncated — when the path fails validation, and always
   * omitted for reserved, preview, and unknown routes.
   */
  rawPath?: string
  /** Allowlisted, validated campaign parameters. Empty object when none survive. */
  campaign: WatchAnalyticsCampaign
  /** Payload-only content identity (R21). Absent when the route has none. */
  contentSlug?: string
  /** Payload-only parent-series identity for contextual episode URLs (R21). */
  seriesSlug?: string
  /** Payload-only exact language slug, alias-resolved (R21). */
  languageSlug?: string
  /**
   * In-memory deduplication key for "one page view per committed route key"
   * (R6, owned by U3). Built from the committed browser path plus the
   * sanitized campaign set, so query cleanup and rerenders collapse while two
   * genuinely different paths never do. NEVER sent to any provider.
   */
  pageViewKey: string
}

/** Fixed analytics-only path for unknown or invalid routes. R5 forbids guessing them into a content family. */
export const WATCH_ANALYTICS_UNKNOWN_PATH = `${WATCH_BASE_PATH}/_unknown`

/**
 * Maximum characters for any value that may reach GA — campaign values and
 * the retained raw path alike. GA4 itself truncates event-parameter values at
 * 100 characters, so a longer value could not round-trip anyway; omitting is
 * honest where truncating would invent a path that was never requested.
 */
export const WATCH_ANALYTICS_MAX_VALUE_LENGTH = 100

/** Upper bound for the canonical path. Beyond this the route resolves to `unknown` rather than emitting a partial identity. */
const MAX_CANONICAL_PATH_LENGTH = 200

/** Upper bound for the in-memory dedupe key. Never sent anywhere. */

/** Upper bound for a referrer before any parsing is attempted. */
const MAX_REFERRER_LENGTH = 512

/**
 * Campaign parameters allowed into `page_location` (R7).
 *
 * Click identifiers (`gclid`, `fbclid`, `msclkid`, …) are deliberately
 * EXCLUDED: they identify an individual click and are cross-site linkable,
 * which R19 bans regardless of their attribution value.
 */
export const WATCH_ANALYTICS_CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
] as const

/** The shared default Watch language as a branded slug. */
const DEFAULT_LANGUAGE_SLUG = asLocaleSlug(DEFAULT_WATCH_LANGUAGE_SLUG)

// Watch one-shot parameters. They express intent about a single arrival and
// must never create a page identity (R7). `t` and `autoplay` are private to
// `./routes`; `watch-analytics-route.test.ts` pins both against the query
// string `watchVideoPath` actually emits, so a rename there fails a test here
// instead of silently dropping the classification.
const ONE_SHOT_TIMESTAMP_PARAM = "t"
const ONE_SHOT_AUTOPLAY_PARAM = "autoplay"

// --- Value safety -----------------------------------------------------------

// Printable, URL-safe ASCII only. Rejects control characters (including
// percent-decoded ones such as `%0a`), quotes, angle brackets, and `@`, which
// is what makes the e-mail check below belt-and-braces rather than the only
// guard.
const SAFE_VALUE_CHARS = /^[A-Za-z0-9._~+ -]+$/

const EMAIL_LIKE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

// Whole-word-ish credential vocabulary. The surrounding non-letter assertions
// keep ordinary content slugs out of the net ("monkey" is not "key",
// "authority" is not "auth"). It is still deliberately conservative: a slug
// that really does contain "secret" as a word resolves to `unknown` rather
// than risking a secret on the GA wire.
const CREDENTIAL_LIKE =
  /(?:^|[^A-Za-z])(?:api[_-]?key|apikey|secret|password|passwd|pwd|token|bearer|credential|access[_-]?key|session[_-]?id|auth)(?:[^A-Za-z]|$)/i

/** Compact JWT header (`eyJ...`), the shape every base64url-encoded JSON token starts with. */
const JWT_LIKE = /eyJ[A-Za-z0-9_-]{8,}/

/** Long opaque hex runs — session ids, digests, capability tokens. */
const LONG_HEX = /(?:^|[^A-Fa-f0-9])[A-Fa-f0-9]{24,}(?:[^A-Fa-f0-9]|$)/

/**
 * The shape-based leak detectors, shared so every value lane screens for the
 * same things. These are lane-agnostic: no authored title, campaign value, or
 * route slug can legitimately look like an email address, a JWT, or a long
 * opaque hex run, so any lane that admits one is leaking.
 *
 * `CREDENTIAL_LIKE` is deliberately NOT here — it is a word heuristic that the
 * authored-slug lane must not apply (see `isWatchAnalyticsSafeSlug`).
 */
export const WATCH_ANALYTICS_LEAK_PATTERNS = [
  EMAIL_LIKE,
  JWT_LIKE,
  LONG_HEX,
] as const

/**
 * Whether a single bounded value may reach GA. One policy, applied to both
 * campaign values and individual path segments (R19): a pathname is
 * attacker- and user-influenceable, so length-bounding alone is not enough.
 */
export function isWatchAnalyticsSafeValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= WATCH_ANALYTICS_MAX_VALUE_LENGTH &&
    SAFE_VALUE_CHARS.test(value) &&
    !EMAIL_LIKE.test(value) &&
    !CREDENTIAL_LIKE.test(value) &&
    !JWT_LIKE.test(value) &&
    !LONG_HEX.test(value)
  )
}

/**
 * Whether an authored route slug may reach GA.
 *
 * Deliberately narrower than `isWatchAnalyticsSafeValue`: it drops the
 * credential-WORD heuristic and keeps every structural and high-entropy check.
 * A content or language slug is authored editorial text that already passed
 * `parseWatchPath` and `tryAsContentSlug`/`tryAsLocaleSlug`, and R21 sanctions
 * emitting it bounded and validated — whereas campaign values and raw paths are
 * arbitrary user input and keep the full policy.
 *
 * The distinction is load-bearing. A film legitimately titled "The Secret
 * Place" or "Authority" trips `CREDENTIAL_LIKE`, and applying that heuristic
 * here would collapse the video to `/watch/_unknown` and silently erase its
 * analytics identity — the precise class of measurement gap this contract
 * exists to close, and invisible once shipped because the video would simply
 * report no traffic. High-entropy shapes (JWT, long hex runs) stay rejected on
 * every surface: no authored title has them, so they can only be a leak.
 */
function isWatchAnalyticsSafeSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= WATCH_ANALYTICS_MAX_VALUE_LENGTH &&
    SAFE_VALUE_CHARS.test(value) &&
    !EMAIL_LIKE.test(value) &&
    !JWT_LIKE.test(value) &&
    !LONG_HEX.test(value)
  )
}

/**
 * Whether an arbitrary same-origin pathname may reach GA as part of a
 * referrer. Every segment runs the FULL value policy, credential-word
 * heuristic included, because nothing upstream constrained this path to
 * authored route slugs.
 */
export function isWatchAnalyticsSafeReferrerPath(path: string): boolean {
  if (path.length === 0 || path.length > WATCH_ANALYTICS_MAX_VALUE_LENGTH) {
    return false
  }
  if (!path.startsWith("/") || path.includes("//")) return false
  const segments = path.split("/").filter(Boolean)
  if (segments.length === 0) return path === "/"
  return segments.every(isWatchAnalyticsSafeValue)
}

/**
 * Whether a retained raw pathname may reach GA as `watch_raw_path`.
 *
 * Uses the slug policy, not the full value policy: a raw path is only ever
 * built for a route `projectRoute` already recognized, so its segments are the
 * same authored slugs the canonical path is assembled from. Judging the two
 * by different rules would let one survive while the other is dropped for the
 * identical text.
 */
function isWatchAnalyticsSafePath(path: string): boolean {
  if (path.length === 0 || path.length > WATCH_ANALYTICS_MAX_VALUE_LENGTH) {
    return false
  }
  if (!path.startsWith("/") || path.includes("//")) return false
  const segments = path.split("/").filter(Boolean)
  if (segments.length === 0) return path === "/"
  return segments.every(isWatchAnalyticsSafeSlug)
}

// --- Query handling ---------------------------------------------------------

function toSearchParams(
  search: WatchAnalyticsRouteInput["search"],
): URLSearchParams {
  if (search == null) return new URLSearchParams()
  if (typeof search !== "string") return new URLSearchParams(search)
  try {
    return new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search,
    )
  } catch {
    return new URLSearchParams()
  }
}

/**
 * Keep only allowlisted campaign keys whose value passes the safety policy
 * (R7). A repeated key keeps its FIRST value, matching `URLSearchParams.get`
 * and the browser's own "first wins" reading of duplicated UTM tags.
 */
export function sanitizeWatchAnalyticsCampaign(
  search: WatchAnalyticsRouteInput["search"],
): WatchAnalyticsCampaign {
  const params = toSearchParams(search)
  const sanitized: Record<string, string> = {}
  for (const key of WATCH_ANALYTICS_CAMPAIGN_PARAMS) {
    if (!params.has(key)) continue
    const value = params.get(key)
    if (value != null && isWatchAnalyticsSafeValue(value)) {
      sanitized[key] = value
    }
  }
  return sanitized
}

function campaignQueryString(campaign: WatchAnalyticsCampaign): string {
  const keys = Object.keys(campaign).sort()
  if (keys.length === 0) return ""
  const params = new URLSearchParams()
  for (const key of keys) {
    const value = campaign[key]
    if (value != null) params.set(key, value)
  }
  return params.toString()
}

function resolveEntryIntent(
  search: WatchAnalyticsRouteInput["search"],
  campaign: WatchAnalyticsCampaign,
): WatchAnalyticsEntryIntent {
  const params = toSearchParams(search)
  if (params.has(LOCALE_RESOLVED_PARAM)) return "locale_resolved"
  if (Object.keys(campaign).length > 0) return "campaign"
  if (params.has(ONE_SHOT_TIMESTAMP_PARAM)) return "deep_link_timestamp"
  if (params.has(SUBTITLE_INTENT_PARAM)) return "subtitle_intent"
  if (params.has(ONE_SHOT_AUTOPLAY_PARAM)) return "autoplay"
  return "direct"
}

// --- Path handling ----------------------------------------------------------

/**
 * Strip the `/watch` basePath EXACTLY once and normalize a single trailing
 * slash. basePath-free inputs pass through unchanged, so the same fixture
 * works with or without the prefix.
 */
function stripBasePathOnce(pathname: string): string {
  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? ""
  let relative = withoutQuery
  if (relative === WATCH_BASE_PATH) {
    relative = "/"
  } else if (relative.startsWith(`${WATCH_BASE_PATH}/`)) {
    relative = relative.slice(WATCH_BASE_PATH.length)
  }
  if (relative.length > 1 && relative.endsWith("/")) {
    relative = relative.slice(0, -1)
  }
  return relative === "" ? "/" : relative
}

/** Restore the basePath EXACTLY once onto a route-builder result. */
function withBasePath(relativePath: string): string {
  return relativePath === "/"
    ? WATCH_BASE_PATH
    : `${WATCH_BASE_PATH}${relativePath}`
}

function safeContentSlug(value: string): ContentSlug | null {
  const slug = tryAsContentSlug(value)
  return slug != null && isWatchAnalyticsSafeSlug(slug) ? slug : null
}

function safeLocaleSlug(value: string): LocaleSlug | null {
  const slug = tryAsLocaleSlug(value)
  return slug != null && isWatchAnalyticsSafeSlug(slug) ? slug : null
}

type ResolvedLanguage = { slug: LocaleSlug; aliasApplied: boolean }

/** Resolve a URL language segment through the shared alias table (R3), then bound it. */
function resolveLanguageSegment(value: string): ResolvedLanguage | null {
  const alias = tryResolveLanguageAlias(value)
  const slug = safeLocaleSlug(alias ?? value)
  if (slug == null) return null
  return { slug, aliasApplied: alias != null && alias !== value }
}

function languageClassFor(slug: string): WatchAnalyticsLanguageClass {
  return slug === DEFAULT_WATCH_LANGUAGE_SLUG ? "english" : "non_english"
}

/** Whether a one-segment path names a public language home rather than content. */
function isLanguageHomeSegment(bare: string): boolean {
  return (
    isPublicWatchLanguageSlug(bare) || tryResolveLanguageAlias(bare) != null
  )
}

type RouteProjection = {
  routeType: WatchAnalyticsRouteType
  canonicalRelativePath: string
  languageClass: WatchAnalyticsLanguageClass
  /** Set only when the structural form already decides the variant. */
  forcedVariant?: WatchAnalyticsRouteVariant
  aliasApplied?: boolean
  explicitDefaultLanguage?: boolean
  contentSlug?: string
  seriesSlug?: string
  languageSlug?: string
  /** Reserved and preview subtrees may carry capability tokens or asset hashes. */
  suppressRawPath?: boolean
}

function projectRoute(
  parsed: ParsedWatchPath,
  relativePath: string,
): RouteProjection | null {
  switch (parsed.kind) {
    case "home":
      return {
        routeType: "home",
        canonicalRelativePath: "/",
        languageClass: "none",
      }

    case "localized-home": {
      // `parseWatchPath` reads every one-segment path as a language home; the
      // canonical English standalone video form `/jesus.html` lands here too.
      // Splitting them uses the SAME eligibility rule the builders use
      // (a public language slug owns its one-segment path, content does not).
      const [firstSegment] = relativePath.split("/").filter(Boolean)
      if (firstSegment == null || !hasHtmlSuffix(firstSegment)) return null

      if (isLanguageHomeSegment(parsed.lang)) {
        const language = resolveLanguageSegment(parsed.lang)
        if (language == null) return null
        return {
          routeType: "language_home",
          canonicalRelativePath: localizedHomePath(language.slug),
          languageClass: languageClassFor(language.slug),
          aliasApplied: language.aliasApplied,
          languageSlug: language.slug,
        }
      }

      const content = safeContentSlug(parsed.lang)
      if (content == null) return null
      return {
        routeType: "video",
        canonicalRelativePath: watchVideoPath(content, DEFAULT_LANGUAGE_SLUG),
        languageClass: "english",
        contentSlug: content,
        languageSlug: DEFAULT_LANGUAGE_SLUG,
      }
    }

    case "video": {
      const content = safeContentSlug(parsed.slug)
      const language = resolveLanguageSegment(parsed.lang)
      if (content == null || language == null) return null
      return {
        routeType: "video",
        canonicalRelativePath: watchVideoPath(content, language.slug),
        languageClass: languageClassFor(language.slug),
        aliasApplied: language.aliasApplied,
        explicitDefaultLanguage: language.slug === DEFAULT_WATCH_LANGUAGE_SLUG,
        contentSlug: content,
        languageSlug: language.slug,
      }
    }

    case "episode": {
      // R4: attribute a contextual episode URL to the episode's own
      // standalone canonical identity; the parent stays as bounded diagnostics.
      const series = safeContentSlug(parsed.series)
      const episode = safeContentSlug(parsed.episode)
      const language = resolveLanguageSegment(parsed.lang)
      if (series == null || episode == null || language == null) return null
      return {
        routeType: "video",
        canonicalRelativePath: watchVideoPath(episode, language.slug),
        languageClass: languageClassFor(language.slug),
        forcedVariant: "contextual",
        contentSlug: episode,
        seriesSlug: series,
        languageSlug: language.slug,
      }
    }

    case "languages":
      return {
        routeType: "languages",
        canonicalRelativePath: languagesIndexPath(),
        languageClass: "none",
      }

    case "localized-languages": {
      const language = resolveLanguageSegment(parsed.lang)
      if (language == null) return null
      return {
        routeType: "languages",
        canonicalRelativePath: localizedLanguagesPath(language.slug),
        languageClass: languageClassFor(language.slug),
        aliasApplied: language.aliasApplied,
        languageSlug: language.slug,
      }
    }

    case "whats-new":
      return {
        routeType: "whats_new",
        canonicalRelativePath: whatsNewPath(),
        languageClass: "none",
      }

    case "history":
      // No builder exists for the language-less history path; `/history` is
      // the literal `parseWatchPath` recognizes.
      return {
        routeType: "history",
        canonicalRelativePath: "/history",
        languageClass: "none",
      }

    case "localized-history": {
      const language = resolveLanguageSegment(parsed.lang)
      if (language == null) return null
      return {
        routeType: "history",
        canonicalRelativePath: localizedHistoryPath(language.slug),
        languageClass: languageClassFor(language.slug),
        aliasApplied: language.aliasApplied,
        languageSlug: language.slug,
      }
    }

    case "language-videos": {
      const language = resolveLanguageSegment(parsed.lang)
      if (language == null) return null
      return {
        routeType: "language_inventory",
        canonicalRelativePath: languageVideosIndexPath(language.slug),
        languageClass: languageClassFor(language.slug),
        aliasApplied: language.aliasApplied,
        languageSlug: language.slug,
      }
    }

    case "search":
      return {
        routeType: "search",
        canonicalRelativePath: "/search",
        languageClass: "none",
      }

    case "reserved":
      // The prefix comes from the shared `RESERVED_PREFIXES` set, so it is a
      // finite known value. Everything after it is dropped: the preview
      // subtree carries an access token and `_next`/`assets` carry build
      // hashes, neither of which may reach an analytics payload (R19).
      return {
        routeType: parsed.prefix === "preview" ? "preview" : "reserved",
        canonicalRelativePath: `/${parsed.prefix}`,
        languageClass: "none",
        forcedVariant: "not_applicable",
        suppressRawPath: true,
      }

    case "unknown":
      return null
  }
}

function resolveVariant(
  projection: RouteProjection,
  canonicalRelativePath: string,
  relativePath: string,
): WatchAnalyticsRouteVariant {
  if (projection.forcedVariant != null) return projection.forcedVariant
  if (canonicalRelativePath === relativePath) return "canonical"
  if (projection.aliasApplied === true) return "language_alias_compatibility"
  if (projection.explicitDefaultLanguage === true) {
    return "explicit_language_compatibility"
  }
  return "non_canonical"
}

function unknownContext(
  relativePath: string,
  campaign: WatchAnalyticsCampaign,
  entryIntent: WatchAnalyticsEntryIntent,
): WatchAnalyticsRouteContext {
  return {
    routeType: "unknown",
    routeVariant: "not_applicable",
    languageClass: "none",
    entryIntent,
    canonicalPath: WATCH_ANALYTICS_UNKNOWN_PATH,
    canonicalLocation: buildLocation(WATCH_ANALYTICS_UNKNOWN_PATH, campaign),
    campaign,
    pageViewKey: buildPageViewKey(relativePath, campaign),
  }
}

function buildLocation(
  canonicalPath: string,
  campaign: WatchAnalyticsCampaign,
): string {
  const query = campaignQueryString(campaign)
  return `${WATCH_CANONICAL_ORIGIN}${canonicalPath}${query === "" ? "" : `?${query}`}`
}

function buildPageViewKey(
  relativePath: string,
  campaign: WatchAnalyticsCampaign,
): string {
  const key = `${relativePath}|${campaignQueryString(campaign)}`
  // Deliberately NOT truncated. This key never leaves memory and is never
  // emitted, so there is nothing to bound — while truncating it would let two
  // distinct long routes share a key and silently suppress the second page
  // view, which is the exact failure R6 forbids.
  return key
}

/**
 * Project a committed browser route onto one canonical Watch analytics
 * identity (R1). Pure: same input, same output, no I/O.
 *
 * Unknown or invalid paths resolve to the fixed
 * `WATCH_ANALYTICS_UNKNOWN_PATH` with route type `unknown` and no raw path,
 * so R5's no-guessing rule and R6's one-view-per-commit rule both hold.
 */
export function resolveWatchAnalyticsRoute(
  input: WatchAnalyticsRouteInput,
): WatchAnalyticsRouteContext {
  const campaign = sanitizeWatchAnalyticsCampaign(input.search)
  const entryIntent = resolveEntryIntent(input.search, campaign)
  const relativePath = stripBasePathOnce(input.pathname ?? "")

  const projection = projectRoute(parseWatchPath(relativePath), relativePath)
  if (projection == null) {
    return unknownContext(relativePath, campaign, entryIntent)
  }

  const canonicalPath = withBasePath(projection.canonicalRelativePath)
  if (canonicalPath.length > MAX_CANONICAL_PATH_LENGTH) {
    return unknownContext(relativePath, campaign, entryIntent)
  }

  const rawPath = withBasePath(relativePath)
  const retainRawPath =
    projection.suppressRawPath !== true && isWatchAnalyticsSafePath(rawPath)

  return {
    routeType: projection.routeType,
    routeVariant: resolveVariant(
      projection,
      projection.canonicalRelativePath,
      relativePath,
    ),
    languageClass: projection.languageClass,
    entryIntent,
    canonicalPath,
    canonicalLocation: buildLocation(canonicalPath, campaign),
    ...(retainRawPath ? { rawPath } : {}),
    campaign,
    ...(projection.contentSlug != null
      ? { contentSlug: projection.contentSlug }
      : {}),
    ...(projection.seriesSlug != null
      ? { seriesSlug: projection.seriesSlug }
      : {}),
    ...(projection.languageSlug != null
      ? { languageSlug: projection.languageSlug }
      : {}),
    pageViewKey: buildPageViewKey(relativePath, campaign),
  }
}

/**
 * Bound a referrer for the explicit `page_referrer` GA field (R7). gtag would
 * otherwise send `document.referrer` verbatim, which R19's full-referrer ban
 * forbids.
 *
 * Same-origin referrers keep origin plus their query-free path, and are
 * suppressed entirely when that path fails the value policy. Cross-origin
 * referrers keep their ORIGIN only: an external path is never needed for
 * source attribution and is exactly the surface that carries other sites'
 * user-identifying values.
 */
export function sanitizeWatchAnalyticsReferrer(
  referrer: string | null | undefined,
): string | undefined {
  if (
    typeof referrer !== "string" ||
    referrer === "" ||
    referrer.length > MAX_REFERRER_LENGTH
  ) {
    return undefined
  }

  let url: URL
  try {
    url = new URL(referrer)
  } catch {
    return undefined
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
  if (url.username !== "" || url.password !== "") return undefined

  let canonicalOrigin: string
  try {
    canonicalOrigin = new URL(WATCH_CANONICAL_ORIGIN).origin
  } catch {
    return undefined
  }

  if (url.origin !== canonicalOrigin) return url.origin
  if (url.pathname === "/") return `${url.origin}/`
  // The STRICT lane, not the slug lane. A referrer pathname is arbitrary
  // same-origin input — it can be `/account/reset-password/<token>` — unlike
  // `watch_raw_path`, which is only ever assembled from a route the resolver
  // already recognized. Judging it by the authored-slug policy would skip the
  // credential screen on the one field most likely to carry a secret.
  return isWatchAnalyticsSafeReferrerPath(url.pathname)
    ? `${url.origin}${url.pathname}`
    : undefined
}
