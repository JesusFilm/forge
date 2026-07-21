import "server-only"

import { randomUUID } from "node:crypto"
import { after } from "next/server"

import { env } from "@/env"
import { sendDatadogStructuredLog } from "@/observability/datadog-logs"

import type { SearchActionResultSource } from "./search"
import {
  WATCH_SEARCH_ANALYTICS_SURFACE,
  type WatchSearchAnalyticsContext,
  type WatchSearchLaneStatusAnalytics,
  type WatchSearchRequestType,
} from "./watch-search-analytics-contract"

export type WatchSearchAnalyticsOutcome = "completed" | "failed" | "no_result"

export type WatchSearchFailureCategory =
  | "watch_search_error"
  | "source_mismatch"
  | "unexpected_error"

export type BuildWatchSearchAnalyticsLogEventInput = {
  addedResultCount?: number | null
  degraded?: boolean | null
  detectedQueryLanguage?: string | null
  expectedResultSource?: SearchActionResultSource | null
  failureCategory?: WatchSearchFailureCategory | null
  latencyMs?: number | null
  laneStatuses?: readonly WatchSearchLaneStatusAnalytics[] | null
  offset?: number | null
  outcome: WatchSearchAnalyticsOutcome
  query: string
  requestType?: WatchSearchRequestType | null
  requestedSearchMode?: string | null
  resolvedLanguageSlug?: string | null
  responseSearchMode?: string | null
  resultCount?: number | null
  resultSource?: SearchActionResultSource | null
  routeLanguageSlug?: string | null
  searchLanguageEnglishName?: string | null
  searchLanguageSlug?: string | null
  searchRequestId?: string | null
  surface?: string | null
  visibleResultCount?: number | null
  watchContext?: WatchSearchAnalyticsContext | null
}

export type WatchSearchAnalyticsLogEvent = {
  attributes: Record<string, boolean | number | string>
  level: "error" | "info"
  message: "watch_search analytics"
}

type AfterFunction = (callback: () => void | Promise<void>) => void

type ScheduleWatchSearchAnalyticsOptions = {
  afterFn?: AfterFunction
  send?: (event: WatchSearchAnalyticsLogEvent) => Promise<void> | void
}

const MAX_QUERY_LENGTH = 200
const MAX_SHORT_TEXT_LENGTH = 160
const MAX_ROUTE_LENGTH = 240
const MAX_LANE_SUMMARY_LENGTH = 500
const MAX_LANE_STATUS_COUNT = 12
const SEARCH_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

export function buildWatchSearchAnalyticsLogEvent(
  input: BuildWatchSearchAnalyticsLogEventInput,
): WatchSearchAnalyticsLogEvent | null {
  if (input.surface !== WATCH_SEARCH_ANALYTICS_SURFACE) return null

  const attributes: Record<string, boolean | number | string> = {
    "watch_search.event_name": "watch_search",
    "watch_search.exact_query_included":
      env.WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT,
    "watch_search.outcome": input.outcome,
    "watch_search.request_type": normalizeRequestType(input.requestType),
    "watch_search.search_request_id": normalizeSearchRequestId(
      input.searchRequestId,
    ),
    "watch_search.surface": WATCH_SEARCH_ANALYTICS_SURFACE,
  }

  if (env.WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT) {
    attributes["watch_search.query"] = input.query.slice(0, MAX_QUERY_LENGTH)
  }

  addNonNegativeInt(attributes, "watch_search.result_count", input.resultCount)
  addNonNegativeInt(
    attributes,
    "watch_search.added_result_count",
    input.addedResultCount,
  )
  addNonNegativeInt(
    attributes,
    "watch_search.visible_result_count",
    input.visibleResultCount,
  )
  addNonNegativeInt(attributes, "watch_search.offset", input.offset)
  addNonNegativeNumber(attributes, "watch_search.latency_ms", input.latencyMs)
  addBoolean(attributes, "watch_search.degraded", input.degraded)
  addLaneStatuses(attributes, input.laneStatuses)
  addResultSource(attributes, "watch_search.result_source", input.resultSource)
  addResultSource(
    attributes,
    "watch_search.expected_result_source",
    input.expectedResultSource,
  )
  addToken(attributes, "watch_search.failure_category", input.failureCategory)
  addBoundedText(
    attributes,
    "watch_search.requested_search_mode",
    input.requestedSearchMode,
  )
  addBoundedText(
    attributes,
    "watch_search.response_search_mode",
    input.responseSearchMode,
  )
  addToken(
    attributes,
    "watch_search.route_language_slug",
    input.routeLanguageSlug,
  )
  addToken(
    attributes,
    "watch_search.search_language_slug",
    input.searchLanguageSlug,
  )
  addBoundedText(
    attributes,
    "watch_search.search_language_english_name",
    input.searchLanguageEnglishName,
  )
  addToken(
    attributes,
    "watch_search.resolved_language_slug",
    input.resolvedLanguageSlug,
  )
  addToken(
    attributes,
    "watch_search.detected_query_language",
    input.detectedQueryLanguage,
  )
  addWatchContext(attributes, input.watchContext)

  return {
    attributes,
    level: input.outcome === "failed" ? "error" : "info",
    message: "watch_search analytics",
  }
}

export function scheduleWatchSearchAnalyticsEvent(
  input: BuildWatchSearchAnalyticsLogEventInput,
  options: ScheduleWatchSearchAnalyticsOptions = {},
): void {
  if (input.surface !== WATCH_SEARCH_ANALYTICS_SURFACE) return

  const afterFn = options.afterFn ?? after
  const send = options.send ?? sendWatchSearchAnalyticsLogEvent

  try {
    afterFn(() => {
      try {
        const event = buildWatchSearchAnalyticsLogEvent(input)
        if (!event) return
        void Promise.resolve(send(event)).catch(() => {})
      } catch {
        // Best-effort analytics must never affect the search response path.
      }
    })
  } catch {
    // Some test/preview paths may not allow after() scheduling.
  }
}

export function sendWatchSearchAnalyticsLogEvent(
  event: WatchSearchAnalyticsLogEvent,
): void {
  sendDatadogStructuredLog({
    attributes: event.attributes,
    level: event.level,
    message: event.message,
  })
}

function normalizeSearchRequestId(value: string | null | undefined): string {
  const candidate = value?.trim()
  if (candidate && SEARCH_REQUEST_ID_PATTERN.test(candidate)) return candidate
  return randomUUID()
}

function normalizeRequestType(
  requestType: WatchSearchRequestType | null | undefined,
): WatchSearchRequestType {
  return requestType === "load_more" ? "load_more" : "search"
}

function addNonNegativeInt(
  attributes: Record<string, boolean | number | string>,
  key: string,
  value: number | null | undefined,
): void {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return
  attributes[key] = Math.floor(parsed)
}

function addNonNegativeNumber(
  attributes: Record<string, boolean | number | string>,
  key: string,
  value: number | null | undefined,
): void {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return
  attributes[key] = parsed
}

function addBoolean(
  attributes: Record<string, boolean | number | string>,
  key: string,
  value: boolean | null | undefined,
): void {
  if (typeof value === "boolean") attributes[key] = value
}

function addBoundedText(
  attributes: Record<string, boolean | number | string>,
  key: string,
  value: string | null | undefined,
  maxLength = MAX_SHORT_TEXT_LENGTH,
): void {
  const normalized = boundedText(value, maxLength)
  if (normalized) attributes[key] = normalized
}

function addToken(
  attributes: Record<string, boolean | number | string>,
  key: string,
  value: string | null | undefined,
): void {
  const normalized = boundedText(value, MAX_SHORT_TEXT_LENGTH)
  if (!normalized || !SAFE_TOKEN_PATTERN.test(normalized)) return
  attributes[key] = normalized
}

function addLaneStatuses(
  attributes: Record<string, boolean | number | string>,
  laneStatuses: readonly WatchSearchLaneStatusAnalytics[] | null | undefined,
): void {
  if (!laneStatuses?.length) return

  const sanitized = laneStatuses
    .slice(0, MAX_LANE_STATUS_COUNT)
    .flatMap((status) => {
      const lane = safeToken(status.lane)
      const state = safeToken(status.status)
      if (!lane || !state) return []

      const reason = safeToken(status.reason)
      const elapsedMs = nonNegativeNumber(status.elapsedMs)
      const resultCount = nonNegativeInt(status.resultCount)
      return [
        {
          elapsedMs,
          lane,
          reason,
          resultCount,
          status: state,
        },
      ]
    })

  if (sanitized.length === 0) return

  attributes["watch_search.lane_count"] = sanitized.length
  attributes["watch_search.fulfilled_lane_count"] = sanitized.filter(
    (status) => status.status === "fulfilled",
  ).length
  attributes["watch_search.degraded_lane_count"] = sanitized.filter(
    (status) => status.status === "degraded",
  ).length
  attributes["watch_search.skipped_lane_count"] = sanitized.filter(
    (status) => status.status === "skipped",
  ).length
  attributes["watch_search.lane_elapsed_ms_max"] = Math.max(
    ...sanitized.map((status) => status.elapsedMs ?? 0),
  )
  attributes["watch_search.lane_result_count"] = sanitized.reduce(
    (sum, status) => sum + (status.resultCount ?? 0),
    0,
  )

  const summary = sanitized
    .map((status) => {
      const parts = [`${status.lane}:${status.status}`]
      if (status.reason) parts.push(`reason=${status.reason}`)
      if (status.elapsedMs != null) parts.push(`ms=${status.elapsedMs}`)
      if (status.resultCount != null) parts.push(`count=${status.resultCount}`)
      return parts.join(",")
    })
    .join(";")

  const boundedSummary = boundedText(summary, MAX_LANE_SUMMARY_LENGTH)
  if (boundedSummary) {
    attributes["watch_search.lane_statuses"] = boundedSummary
  }
}

function addResultSource(
  attributes: Record<string, boolean | number | string>,
  key: string,
  value: SearchActionResultSource | null | undefined,
): void {
  if (value === "watch-search") attributes[key] = value
}

function safeToken(value: string | null | undefined): string | null {
  const normalized = boundedText(value, MAX_SHORT_TEXT_LENGTH)
  if (!normalized || !SAFE_TOKEN_PATTERN.test(normalized)) return null
  return normalized
}

function nonNegativeInt(value: number | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

function nonNegativeNumber(value: number | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function addWatchContext(
  attributes: Record<string, boolean | number | string>,
  context: WatchSearchAnalyticsContext | null | undefined,
): void {
  if (!context) return

  const pageRoute = sanitizeRoute(context.pageRoute)
  if (pageRoute) attributes["watch_context.page_route"] = pageRoute

  const referrerOrigin = sanitizeReferrerOrigin(context.referrerOrigin)
  if (referrerOrigin) {
    attributes["watch_context.referrer_origin"] = referrerOrigin
  }

  addToken(attributes, "watch_context.video_id", context.videoId)
  addToken(attributes, "watch_context.video_slug", context.videoSlug)
  addToken(
    attributes,
    "watch_context.route_language_slug",
    context.routeLanguageSlug,
  )
  addToken(
    attributes,
    "watch_context.audio_language_slug",
    context.audioLanguageSlug,
  )
  addNonNegativeNumber(
    attributes,
    "watch_context.playback_position_seconds",
    context.playbackPositionSeconds,
  )
}

function boundedText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null
  const normalized = value.replace(/[\r\n\t]/g, " ").trim()
  if (!normalized) return null
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized
}

function sanitizeRoute(value: string | null | undefined): string | null {
  if (!value) return null

  try {
    const url = value.startsWith("/")
      ? new URL(value, "https://watch.local")
      : new URL(value)
    return boundedText(url.pathname || "/", MAX_ROUTE_LENGTH)
  } catch {
    return null
  }
}

function sanitizeReferrerOrigin(
  value: string | null | undefined,
): string | null {
  if (!value) return null

  try {
    const url = new URL(value)
    if (isIpLikeHost(url.hostname)) return null
    return boundedText(url.origin, MAX_ROUTE_LENGTH)
  } catch {
    return null
  }
}

function isIpLikeHost(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")
}
