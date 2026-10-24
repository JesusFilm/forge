// Typed, versioned Watch analytics event contract and the single dispatcher
// that puts those events on the Google Analytics 4 wire (R9, R10, KTD5).
//
// This module is the source of event meaning. A call site names a DECLARED
// event and supplies typed fields; it never passes a free-form string through
// an implicit normalizer, and it never touches `window.gtag` itself. Adding an
// event is an edit here, which is what makes "an undeclared event or parameter
// is a type/test failure rather than a silent rename" true.
//
// -----------------------------------------------------------------------------
// GA4 naming rules this module is written against
// -----------------------------------------------------------------------------
// Google reserves these event names on WEB data streams:
//   click, file_download, video_start, video_progress, view_search_results,
//   page_view, scroll, and the form_* family.
// Event parameter names may not begin with `_`, `ga_`, `google_`, `gtag.`, or
// `firebase_`, and are capped at 40 characters.
//
// Two reserved names are used DELIBERATELY here:
//   - `page_view`      — KTD2 makes this collector the sole owner of SPA page
//                        views, so it must emit the standard name.
//   - `video_progress` — R11/R25 forbid renaming an existing wire name during
//                        the compatibility window.
// Google documents reserved-name enforcement for the Admin UI, not for
// collection, so U6 CONFIRMS IN DEBUGVIEW that both are collected rather than
// rejected. Do not adopt another reserved name without that same evidence.
//
// -----------------------------------------------------------------------------
// Flag boundary
// -----------------------------------------------------------------------------
// Every function that can reach `gtag` is gated on
// `NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2` (KTD6). With the flag off this
// module is inert for EVERY call site at once, so v1 and v2 dispatchers can
// never both run and rollback is one env var plus a rebuild.

import { env } from "@/env"

import {
  WATCH_ANALYTICS_LEAK_PATTERNS,
  WATCH_ANALYTICS_MAX_VALUE_LENGTH,
  WATCH_ANALYTICS_UNKNOWN_PATH,
  type WatchAnalyticsEntryIntent,
  type WatchAnalyticsLanguageClass,
  type WatchAnalyticsRouteContext,
  type WatchAnalyticsRouteVariant,
  isWatchAnalyticsSafeValue,
  resolveWatchAnalyticsRoute,
  sanitizeWatchAnalyticsReferrer,
} from "./watch-analytics-route"

/**
 * Written to a standard GA4 page field whose sanitized value was rejected.
 *
 * This is load-bearing, not cosmetic. GA4 AUTO-COLLECTS `page_location` and
 * `page_referrer` for any event that does not override them, so omitting a
 * field hands Google the raw `window.location.href` / `document.referrer` —
 * the exact values the contract exists to keep off the wire. Every rejection
 * must therefore write something, and it must not parse as a URL.
 */
export const WATCH_ANALYTICS_SUPPRESSED_VALUE = "(suppressed)"

/** Sent as `event_contract_version` on every event so readouts can segment migrations. */
export const WATCH_ANALYTICS_CONTRACT_VERSION = 2

/**
 * R28: the immediate/deferred choice is made PER DISPATCH, not per event name.
 *
 * - `deferred` — the default for interaction-triggered events. The dispatch
 *   waits for a paint yield so it adds no measurable input-latency cost.
 * - `immediate` — for a dispatch whose document may be replaced, or whose tab
 *   may be backgrounded, before that yield runs: outbound CTA activation, the
 *   download handoff, and social-share target activation.
 *
 * `watch_cta_clicked` is immediate only when its resolved destination class is
 * outbound, which is exactly why this is an input rather than a property of
 * the event declaration.
 */
export type WatchAnalyticsDispatchMode = "immediate" | "deferred"

/**
 * THE WIRE NAMES (R25).
 *
 * Left side is the contract's semantic key; right side is the literal string
 * GA4 receives. The legacy names are external contracts — GA4 key-event
 * settings and historical reports live on them — so they are preserved
 * verbatim. No renames and no dual-writes: renaming is a separately reviewed
 * migration, and dual-writing inflates event counts.
 *
 * `search_completed`, `language_applied`, `subtitle_applied`,
 * `download_started`, `share_completed`, and `watch_cta_clicked` are additive
 * outcome events with no history.
 */
export const WATCH_ANALYTICS_WIRE_NAMES = {
  // --- Player (legacy names, R11) ---
  player_started: "videostarts",
  player_play: "videoplay",
  player_pause: "video_pause",
  player_milestone_10: "a_media_progress10",
  player_milestone_25: "a_media_progress25",
  player_milestone_50: "a_media_progress50",
  player_milestone_75: "a_media_progress75",
  player_milestone_90: "a_media_progress90",
  player_meaningful_progress: "video_progress",
  player_completed: "videocomplete",
  // --- Search ---
  search_completed: "search_completed",
  search_result_clicked: "search_result_clicked",
  // --- Language ---
  language_picker_opened: "language_picker_opened",
  language_applied: "language_applied",
  subtitle_applied: "subtitle_applied",
  // --- Download ---
  download_intent: "download_intent",
  download_started: "download_started",
  // --- Share ---
  share_opened: "share_opened",
  share_completed: "share_completed",
  // --- Mission CTA ---
  watch_cta_clicked: "watch_cta_clicked",
  // --- Page view (emitted by `emitWatchAnalyticsPageView`, never dispatched) ---
  page_view: "page_view",
} as const

/** Stable key space for the declared events. Milestones expand per percent. */
export type WatchAnalyticsEventKey = keyof typeof WATCH_ANALYTICS_WIRE_NAMES

/** Fixed milestone percentages. Each has its own legacy wire name. */
export const WATCH_ANALYTICS_MILESTONE_PERCENTS = [10, 25, 50, 75, 90] as const
export type WatchAnalyticsMilestonePercent =
  (typeof WATCH_ANALYTICS_MILESTONE_PERCENTS)[number]

export type WatchAnalyticsSearchOutcome = "results" | "no_results" | "failed"
export type WatchAnalyticsSearchRequestType = "search" | "load_more"
/** Finite count buckets (R20). Raw counts are unbounded cardinality. */
export type WatchAnalyticsCountBucket = "0" | "1-3" | "4-10" | "11-25" | "26+"
/** Finite 1-based position buckets (R20). `"0"` is not a valid position. */
export type WatchAnalyticsPositionBucket =
  | "1"
  | "2-3"
  | "4-10"
  | "11-25"
  | "26+"
export type WatchAnalyticsShareMethod =
  | "copy_link"
  | "copy_embed"
  | "facebook"
  | "x"
export type WatchAnalyticsQualityTier = "low" | "standard" | "high"
export type WatchAnalyticsAccessOutcome = "open" | "granted" | "gated"
export type WatchAnalyticsDestinationClass = "internal" | "outbound"

/**
 * The declared event inputs (R9). Anything not in this union cannot reach the
 * GA wire — the mapper returns `null` for an unknown discriminant, and the
 * builders read only the fields declared here, so a smuggled extra property is
 * dropped by construction rather than normalized into a parameter.
 *
 * High-cardinality identifiers (`contentId`, `dubId`) are payload-only per R21
 * and must not be registered as GA custom dimensions without a measured
 * cardinality review.
 */
export type WatchAnalyticsEventInput =
  | {
      type: "player_started"
      durationSeconds?: number
      positionSeconds?: number
      contentId?: string
      dubId?: string
    }
  | { type: "player_play"; durationSeconds?: number; positionSeconds?: number }
  | {
      type: "player_pause"
      durationSeconds?: number
      positionSeconds?: number
      progressPercent?: number
    }
  | {
      type: "player_milestone"
      milestonePercent: WatchAnalyticsMilestonePercent
      durationSeconds?: number
      positionSeconds?: number
    }
  | {
      type: "player_meaningful_progress"
      durationSeconds?: number
      positionSeconds?: number
      progressPercent?: number
    }
  | {
      type: "player_completed"
      durationSeconds?: number
      progressPercent?: number
    }
  | {
      type: "search_completed"
      outcome: WatchAnalyticsSearchOutcome
      resultCountBucket?: WatchAnalyticsCountBucket
      requestType?: WatchAnalyticsSearchRequestType
    }
  | {
      type: "search_result_clicked"
      /** 1-based rank; bucketed before it reaches the wire. */
      resultPosition?: number
      resultType?: string
      resultSource?: string
    }
  | {
      type: "language_picker_opened"
      languageClass?: WatchAnalyticsLanguageClass
    }
  | {
      type: "language_applied"
      fromLanguageClass: WatchAnalyticsLanguageClass
      toLanguageClass: WatchAnalyticsLanguageClass
      destinationRouteVariant?: WatchAnalyticsRouteVariant
    }
  | {
      type: "subtitle_applied"
      enabled: boolean
      languageClass?: WatchAnalyticsLanguageClass
    }
  | {
      type: "download_intent"
      languageClass?: WatchAnalyticsLanguageClass
      contentId?: string
    }
  | {
      type: "download_started"
      qualityTier?: WatchAnalyticsQualityTier
      accessOutcome?: WatchAnalyticsAccessOutcome
    }
  | { type: "share_opened" }
  | { type: "share_completed"; method: WatchAnalyticsShareMethod }
  | {
      type: "watch_cta_clicked"
      ctaId: string
      destinationClass: WatchAnalyticsDestinationClass
    }

export type WatchAnalyticsDispatchOptions = {
  mode: WatchAnalyticsDispatchMode
  /**
   * Canonical route context. Defaults to the live browser location so a
   * feature component never rebuilds path logic (R10).
   */
  context?: WatchAnalyticsRouteContext
}

// --- Flag -------------------------------------------------------------------

/**
 * KTD6: one build-time flag selects the whole v2 collector. `false`/unset keeps
 * the v1 initialization and emission path untouched; `true` selects the
 * explicit page-view owner and this typed dispatcher TOGETHER, so hybrid
 * v1/v2 behavior cannot create duplicate or contextless events.
 */
export function isWatchAnalyticsContractV2Enabled(): boolean {
  return env.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 === true
}

// --- Parameter safety -------------------------------------------------------

type GoogleAnalyticsParamValue = boolean | number | string
type GoogleAnalyticsParams = Record<string, GoogleAnalyticsParamValue>

/** GA4 forbids parameter names starting with any of these. */
const GA_RESERVED_PARAM_PREFIXES = [
  "_",
  "ga_",
  "google_",
  "gtag.",
  "firebase_",
] as const

/** GA4 caps parameter names at 40 characters. */
const GA_PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

/**
 * Standard page fields (`page_location`, `page_referrer`) are URLs, so they
 * cannot pass the strict URL-segment charset the event lane uses. They get a
 * longer bound and the high-entropy/PII sentinel screen instead. Their VALUES
 * are already produced by the U2 resolver, which bounded and validated every
 * segment before assembling them.
 */
const MAX_STANDARD_FIELD_LENGTH = 500

/**
 * Written as a code-point scan rather than a regex: a character class
 * covering C0 plus DEL is exactly what `no-control-regex` flags, and an
 * inline suppression there is indistinguishable from a mistake.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/**
 * Shapes that are never legitimate in ANY analytics value, on either lane:
 * an e-mail address, a compact JWT, or a long opaque hex run (session ids,
 * digests, capability tokens). Deliberately excludes the credential-WORD
 * heuristic that `isWatchAnalyticsSafeValue` applies, because an authored film
 * slug can legitimately contain a word like "secret" and a canonical URL
 * carrying it must still report traffic.
 */
// Imported, never re-declared: a second copy of a privacy screen drifts
// silently the first time one side is tightened.
const PRIVACY_SENTINELS = WATCH_ANALYTICS_LEAK_PATTERNS

function isAllowedParamName(name: string): boolean {
  if (!GA_PARAM_NAME.test(name)) return false
  const lowered = name.toLowerCase()
  return !GA_RESERVED_PARAM_PREFIXES.some((prefix) =>
    lowered.startsWith(prefix),
  )
}

function containsPrivacySentinel(value: string): boolean {
  return PRIVACY_SENTINELS.some((pattern) => pattern.test(value))
}

/**
 * Event-lane value policy: call-site supplied, so it gets the FULL policy —
 * strict URL-safe charset, 100-character bound, and the e-mail / credential /
 * JWT / long-hex screens.
 */
function sanitizeEventValue(
  value: unknown,
): GoogleAnalyticsParamValue | undefined {
  if (typeof value === "boolean") return value
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return isWatchAnalyticsSafeValue(trimmed) ? trimmed : undefined
}

/**
 * Context-lane value policy for values the U2 resolver already bounded and
 * validated (canonical path/location, raw path, slugs, sanitized referrer).
 */
function sanitizeContextValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_STANDARD_FIELD_LENGTH) {
    return undefined
  }
  if (hasControlCharacter(trimmed)) return undefined
  return containsPrivacySentinel(trimmed) ? undefined : trimmed
}

type ValueLane = "event" | "context"

function assign(
  params: GoogleAnalyticsParams,
  name: string,
  value: unknown,
  lane: ValueLane = "event",
): void {
  if (value == null) return
  if (!isAllowedParamName(name)) return
  const sanitized =
    lane === "context" ? sanitizeContextValue(value) : sanitizeEventValue(value)
  // A dropped optional field never suppresses an otherwise valid event: only
  // the documented optional parameter goes missing.
  if (sanitized === undefined) return
  params[name] = sanitized
}

/**
 * Write a standard GA4 page field that must NEVER be absent.
 *
 * `assign` is correct for optional custom parameters: dropping one loses a
 * dimension. It is wrong for `page_path`, `page_location`, and
 * `page_referrer`, where absence is not "no value" but "collect the raw
 * browser value instead" — a fail-open. These always write, falling back to a
 * safe constant when sanitization rejects the real value.
 */
function assignRequired(
  params: GoogleAnalyticsParams,
  name: string,
  value: unknown,
  fallback: string,
): void {
  const sanitized = value == null ? undefined : sanitizeContextValue(value)
  params[name] = sanitized ?? fallback
}

/** Non-negative whole seconds, capped at a day. Anything else is dropped. */
function boundedSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  if (value < 0 || value > 86_400) return undefined
  return Math.round(value)
}

/** Whole percent in 0..100. Anything else is dropped. */
function boundedPercent(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  if (value < 0 || value > 100) return undefined
  return Math.round(value)
}

/** Finite result-count bucket (R20). `undefined` for a non-count. */
export function watchAnalyticsResultCountBucket(
  count: number,
): WatchAnalyticsCountBucket | undefined {
  if (!Number.isFinite(count) || count < 0) return undefined
  if (count === 0) return "0"
  if (count <= 3) return "1-3"
  if (count <= 10) return "4-10"
  if (count <= 25) return "11-25"
  return "26+"
}

/** Finite 1-based position bucket (R20). `undefined` for a non-position. */
export function watchAnalyticsPositionBucket(
  position: number,
): WatchAnalyticsPositionBucket | undefined {
  if (!Number.isFinite(position) || position < 1) return undefined
  if (position <= 1) return "1"
  if (position <= 3) return "2-3"
  if (position <= 10) return "4-10"
  if (position <= 25) return "11-25"
  return "26+"
}

// --- Common context parameters ----------------------------------------------

/**
 * R10: every Watch event receives the current canonical route context. R7: the
 * standard `page_path` is canonical and query-free and `page_location` retains
 * only the canonical origin, canonical path, and allowlisted campaign values.
 *
 * `pageViewKey` is deliberately absent — it is an in-memory deduplication key
 * and must never reach a provider.
 */
/**
 * The last canonical location this collector emitted a page view for.
 *
 * Module-scoped so an SPA navigation reports the PREVIOUS Watch page as its
 * referrer, matching GA4's own single-page-app convention. Without it every
 * in-session page view would repeat the original external referrer.
 */
let lastEmittedCanonicalLocation: string | undefined

function resolveReferrerForEmit(explicit?: string | null): string | undefined {
  if (explicit != null) return sanitizeWatchAnalyticsReferrer(explicit)
  if (lastEmittedCanonicalLocation != null) return lastEmittedCanonicalLocation
  if (typeof document === "undefined") return undefined
  return sanitizeWatchAnalyticsReferrer(document.referrer)
}

function commonParams(
  context: WatchAnalyticsRouteContext,
): GoogleAnalyticsParams {
  const params: GoogleAnalyticsParams = {
    event_contract_version: WATCH_ANALYTICS_CONTRACT_VERSION,
  }
  assign(params, "watch_route_type", context.routeType)
  assign(params, "watch_route_variant", context.routeVariant)
  assign(params, "watch_language_class", context.languageClass)
  assign(params, "watch_entry_intent", context.entryIntent)
  // Required, not optional — see `assignRequired`. A dropped value here is a
  // fail-open to the raw browser URL, not a missing dimension.
  assignRequired(
    params,
    "page_path",
    context.canonicalPath,
    WATCH_ANALYTICS_UNKNOWN_PATH,
  )
  assignRequired(
    params,
    "page_location",
    context.canonicalLocation,
    WATCH_ANALYTICS_SUPPRESSED_VALUE,
  )
  // Every event, not just page views: gtag re-attaches `document.referrer` to
  // any event that omits it, so a custom event would leak the full external
  // referrer the page view had carefully sanitized away.
  assignRequired(
    params,
    "page_referrer",
    resolveReferrerForEmit(),
    WATCH_ANALYTICS_SUPPRESSED_VALUE,
  )
  assign(params, "watch_raw_path", context.rawPath, "context")
  assign(params, "watch_content_slug", context.contentSlug, "context")
  assign(params, "watch_series_slug", context.seriesSlug, "context")
  assign(params, "watch_language_slug", context.languageSlug, "context")
  return params
}

// --- Event mapping ----------------------------------------------------------

type MappedEvent = {
  key: WatchAnalyticsEventKey
  params: GoogleAnalyticsParams
}

/**
 * Map ONE declared event input onto its wire name and event-specific
 * parameters. Returns `null` for an undeclared discriminant so an unknown
 * event reaches nothing — a runtime rename is never invented.
 */
function mapEvent(
  input: WatchAnalyticsEventInput,
  context: WatchAnalyticsRouteContext,
): MappedEvent | null {
  const params = commonParams(context)

  switch (input.type) {
    case "player_started":
      assign(
        params,
        "watch_duration_seconds",
        boundedSeconds(input.durationSeconds),
      )
      assign(
        params,
        "watch_position_seconds",
        boundedSeconds(input.positionSeconds) ?? 0,
      )
      assign(params, "watch_content_id", input.contentId)
      assign(params, "watch_dub_id", input.dubId)
      return { key: "player_started", params }

    case "player_play":
      assign(
        params,
        "watch_duration_seconds",
        boundedSeconds(input.durationSeconds),
      )
      assign(
        params,
        "watch_position_seconds",
        boundedSeconds(input.positionSeconds),
      )
      return { key: "player_play", params }

    case "player_pause":
      assign(
        params,
        "watch_duration_seconds",
        boundedSeconds(input.durationSeconds),
      )
      assign(
        params,
        "watch_position_seconds",
        boundedSeconds(input.positionSeconds),
      )
      assign(
        params,
        "watch_progress_percent",
        boundedPercent(input.progressPercent),
      )
      return { key: "player_pause", params }

    case "player_milestone": {
      if (
        !WATCH_ANALYTICS_MILESTONE_PERCENTS.includes(input.milestonePercent)
      ) {
        return null
      }
      assign(params, "watch_progress_percent", input.milestonePercent)
      assign(
        params,
        "watch_duration_seconds",
        boundedSeconds(input.durationSeconds),
      )
      assign(
        params,
        "watch_position_seconds",
        boundedSeconds(input.positionSeconds),
      )
      return {
        key: `player_milestone_${input.milestonePercent}` as const,
        params,
      }
    }

    case "player_meaningful_progress":
      assign(
        params,
        "watch_duration_seconds",
        boundedSeconds(input.durationSeconds),
      )
      assign(
        params,
        "watch_position_seconds",
        boundedSeconds(input.positionSeconds),
      )
      assign(
        params,
        "watch_progress_percent",
        boundedPercent(input.progressPercent),
      )
      return { key: "player_meaningful_progress", params }

    case "player_completed":
      assign(
        params,
        "watch_duration_seconds",
        boundedSeconds(input.durationSeconds),
      )
      assign(
        params,
        "watch_progress_percent",
        boundedPercent(input.progressPercent) ?? 100,
      )
      return { key: "player_completed", params }

    case "search_completed":
      // R13: outcome, a bounded count bucket, and request type only. Query
      // text, titles, result ids, request ids, and typed language names are
      // not representable here.
      assign(params, "watch_search_outcome", input.outcome)
      assign(params, "watch_result_count_bucket", input.resultCountBucket)
      assign(params, "watch_search_request_type", input.requestType)
      return { key: "search_completed", params }

    case "search_result_clicked":
      assign(
        params,
        "watch_result_position_bucket",
        input.resultPosition == null
          ? undefined
          : watchAnalyticsPositionBucket(input.resultPosition),
      )
      assign(params, "watch_result_type", input.resultType)
      assign(params, "watch_result_source", input.resultSource)
      return { key: "search_result_clicked", params }

    case "language_picker_opened":
      assign(params, "watch_picker_language_class", input.languageClass)
      return { key: "language_picker_opened", params }

    case "language_applied":
      assign(params, "watch_from_language_class", input.fromLanguageClass)
      assign(params, "watch_to_language_class", input.toLanguageClass)
      assign(
        params,
        "watch_destination_route_variant",
        input.destinationRouteVariant,
      )
      return { key: "language_applied", params }

    case "subtitle_applied":
      assign(params, "watch_subtitle_enabled", input.enabled)
      assign(params, "watch_subtitle_language_class", input.languageClass)
      return { key: "subtitle_applied", params }

    case "download_intent":
      assign(params, "watch_download_language_class", input.languageClass)
      assign(params, "watch_content_id", input.contentId)
      return { key: "download_intent", params }

    case "download_started":
      // R15: quality tier and gate outcome only — never filename, media URL,
      // or session identity.
      assign(params, "watch_quality_tier", input.qualityTier)
      assign(params, "watch_access_outcome", input.accessOutcome)
      return { key: "download_started", params }

    case "share_opened":
      return { key: "share_opened", params }

    case "share_completed":
      assign(params, "watch_share_method", input.method)
      return { key: "share_completed", params }

    case "watch_cta_clicked":
      assign(params, "watch_cta_id", input.ctaId)
      assign(params, "watch_destination_class", input.destinationClass)
      return { key: "watch_cta_clicked", params }

    default:
      // An undeclared event reaches nothing. Exhaustive over the union, so
      // this branch only fires for a runtime value TypeScript never allowed.
      return null
  }
}

// --- Google tag emission ----------------------------------------------------

function emitToGoogleTag(
  wireName: string,
  params: GoogleAnalyticsParams,
): void {
  if (typeof window === "undefined") return
  const gtag = window.gtag
  if (typeof gtag !== "function") return
  try {
    gtag("event", wireName, params)
  } catch {
    // Containment belongs at the shared sink, not only in the deferred flush
    // loop: the page-view path and every immediate-mode dispatch call straight
    // through here, and analytics must never break the surface that fired it.
  }
}

// --- Scheduling seam (KTD9) -------------------------------------------------
//
// ONE seam owns dispatch timing for every custom event. Its lifetime is
// MODULE-scoped, not component-scoped, so unmounting a modal cannot cancel a
// dispatch it already queued.
//
// `page_view` bypasses this seam entirely: R6 requires the deduper and the
// emit to happen in one turn, and a deferred page view would let a second
// route commit land first.

type FrameScheduler = (callback: () => void) => void

const defaultFrameScheduler: FrameScheduler = (callback) => {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    window.requestAnimationFrame(() => {
      callback()
    })
    return
  }
  setTimeout(callback, 0)
}

let frameScheduler: FrameScheduler = defaultFrameScheduler
let frameScheduled = false
const pendingDispatches: Array<() => void> = []

/**
 * Replace the paint-yield scheduler. Tests drive the seam explicitly rather
 * than depending on whether jsdom's `requestAnimationFrame` or the
 * `vitest.setup.ts` shim is active. Pass `null` to restore the default.
 */
export function setWatchAnalyticsFrameScheduler(
  scheduler: FrameScheduler | null,
): void {
  frameScheduler = scheduler ?? defaultFrameScheduler
}

/**
 * Emit every queued deferred dispatch now. Idempotent: the queue is drained
 * before anything runs, so a `visibilitychange` flush followed by `pagehide`
 * (or by the frame that was already scheduled) emits nothing twice.
 */
/**
 * Clear the module-scoped emit state (the SPA referrer chain and the pending
 * dispatch queue).
 *
 * Exported for tests only. This state deliberately outlives every component,
 * which also means it outlives a test case — without an explicit reset a suite
 * silently becomes order-dependent, and an assertion can pass because an
 * earlier test left a value behind rather than because the code is right.
 */
export function resetWatchAnalyticsEmitState(): void {
  lastEmittedCanonicalLocation = undefined
  pendingDispatches.length = 0
  frameScheduled = false
}

export function flushWatchAnalyticsDispatches(): void {
  // Clear the scheduler guard FIRST, and unconditionally. The
  // `visibilitychange`/`pagehide` listeners call this directly rather than
  // through `scheduleFlush`, so leaving `frameScheduled` set would make every
  // later `scheduleFlush` a no-op and pile dispatches up behind a frame that
  // may never arrive — which is precisely what those listeners exist to stop.
  frameScheduled = false
  if (pendingDispatches.length === 0) return
  const queued = pendingDispatches.splice(0, pendingDispatches.length)
  for (const run of queued) {
    try {
      run()
    } catch {
      // Analytics must never break the surface that triggered it.
    }
  }
}

function scheduleFlush(): void {
  if (frameScheduled) return
  frameScheduled = true
  frameScheduler(() => {
    frameScheduled = false
    flushWatchAnalyticsDispatches()
  })
}

// `requestAnimationFrame` is SUSPENDED in a backgrounded tab, so a queued
// player milestone would otherwise be lost silently. Registered once, at
// module scope, for the lifetime of the document.
if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushWatchAnalyticsDispatches()
    }
  })
  window.addEventListener("pagehide", () => {
    flushWatchAnalyticsDispatches()
  })
}

// --- Public dispatch --------------------------------------------------------

/**
 * Resolve the canonical route context for the live browser location (R10).
 * Returns the fixed unknown-route context outside the browser.
 */
export function resolveCurrentWatchAnalyticsRouteContext(): WatchAnalyticsRouteContext {
  if (typeof window === "undefined") {
    return resolveWatchAnalyticsRoute({ pathname: "" })
  }
  return resolveWatchAnalyticsRoute({
    pathname: window.location.pathname,
    search: window.location.search,
  })
}

/**
 * THE dispatch entry point for every Watch custom event (F2).
 *
 * ```ts
 * dispatchWatchAnalyticsEvent(
 *   { type: "share_completed", method: "copy_link" },
 *   { mode: "deferred" },
 * )
 * ```
 *
 * Inert when the v2 flag is off, so a migrated call site cannot double-emit
 * alongside v1.
 */
export function dispatchWatchAnalyticsEvent(
  input: WatchAnalyticsEventInput,
  options: WatchAnalyticsDispatchOptions,
): void {
  if (!isWatchAnalyticsContractV2Enabled()) return
  if (typeof window === "undefined") return
  if (input == null || typeof input !== "object") return

  const context = options.context ?? resolveCurrentWatchAnalyticsRouteContext()
  const mapped = mapEvent(input, context)
  if (mapped == null) return

  const wireName = WATCH_ANALYTICS_WIRE_NAMES[mapped.key]
  const emit = () => {
    emitToGoogleTag(wireName, mapped.params)
  }

  if (options.mode === "immediate") {
    emit()
    return
  }

  pendingDispatches.push(emit)
  scheduleFlush()
}

export type WatchAnalyticsPageViewOptions = {
  /** Raw `document.referrer`. Bounded and validated before it reaches GA (R7). */
  referrer?: string | null
}

/**
 * Emit ONE explicit `page_view` (R6-R8, KTD2). Bypasses the scheduling seam:
 * the caller's deduper and this emit must happen in the same turn.
 *
 * `page_referrer` is supplied explicitly rather than left to the browser
 * default, because gtag would otherwise send `document.referrer` verbatim,
 * which R19's full-referrer ban forbids. When validation rejects it the field
 * is written as `WATCH_ANALYTICS_SUPPRESSED_VALUE` — never omitted, because
 * omission is what hands gtag the raw value.
 */
export function emitWatchAnalyticsPageView(
  context: WatchAnalyticsRouteContext,
  options: WatchAnalyticsPageViewOptions = {},
): void {
  if (!isWatchAnalyticsContractV2Enabled()) return

  const params = commonParams(context)
  if (options.referrer !== undefined) {
    assignRequired(
      params,
      "page_referrer",
      resolveReferrerForEmit(options.referrer),
      WATCH_ANALYTICS_SUPPRESSED_VALUE,
    )
  }
  emitToGoogleTag(WATCH_ANALYTICS_WIRE_NAMES.page_view, params)
  // Only after emitting: this page view's referrer is the PREVIOUS page.
  lastEmittedCanonicalLocation =
    params.page_location === context.canonicalLocation
      ? context.canonicalLocation
      : undefined
}

export type {
  WatchAnalyticsEntryIntent,
  WatchAnalyticsLanguageClass,
  WatchAnalyticsRouteContext,
  WatchAnalyticsRouteVariant,
}
export { WATCH_ANALYTICS_MAX_VALUE_LENGTH }
