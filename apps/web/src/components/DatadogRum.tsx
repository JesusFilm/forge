"use client"

import { datadogRum, type RumInitConfiguration } from "@datadog/browser-rum"
import { reactPlugin } from "@datadog/browser-rum-react"
import { useEffect, useRef } from "react"

import { env } from "@/env"
import { reportGoogleAnalyticsEvent } from "@/components/GoogleAnalytics"
import {
  type WatchAnalyticsEventInput,
  dispatchWatchAnalyticsEvent,
  isWatchAnalyticsContractV2Enabled,
} from "@/lib/watch-analytics-contract"
import { WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION } from "@/lib/watch-search-analytics-contract"

const DATADOG_SERVICE = "forge-web"

const DATADOG_ALLOWED_TRACING_URLS = [
  {
    match: "https://api-gateway.central.jesusfilm.org/",
    propagatorTypes: ["tracecontext"],
  },
  {
    match: "https://api-gateway.stage.central.jesusfilm.org/",
    propagatorTypes: ["tracecontext"],
  },
  {
    match: "https://admin.jesusfilm.org/api/graphql",
    propagatorTypes: ["tracecontext"],
  },
] satisfies NonNullable<RumInitConfiguration["allowedTracingUrls"]>

export function getDatadogRumInitConfig(): RumInitConfiguration | null {
  const applicationId = env.NEXT_PUBLIC_DATADOG_APPLICATION_ID
  const clientToken = env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN

  if (!applicationId || !clientToken) return null

  return {
    applicationId,
    clientToken,
    site: env.NEXT_PUBLIC_DATADOG_SITE,
    service: DATADOG_SERVICE,
    env: env.NEXT_PUBLIC_DATADOG_ENV,
    version: env.NEXT_PUBLIC_DATADOG_VERSION,
    sessionSampleRate: 50,
    sessionReplaySampleRate: 10,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    defaultPrivacyLevel: "mask-user-input",
    allowedTracingUrls: DATADOG_ALLOWED_TRACING_URLS,
    plugins: [reactPlugin()],
  }
}

export function reportDatadogRumError(
  error: unknown,
  context: Record<string, unknown>,
) {
  safeReportDatadogRum("error", () => datadogRum.addError(error, context))
}

/**
 * Per-action Google Analytics projection for RUM actions (R13, R18, KTD4).
 *
 * Datadog receives the full, approved diagnostic context for every action. GA
 * receives ONLY the keys listed here, because the GA normalizer strips app
 * prefixes and would otherwise forward content titles, result/request IDs and
 * typed language names to Google.
 *
 * An action absent from this map sends NOTHING to GA. Adding an entry is the
 * deliberate act of putting an event on the GA wire; adding a key to an entry
 * is the deliberate act of putting that value in front of Google. Keys are the
 * pre-normalization RUM context keys.
 */
export const GOOGLE_ANALYTICS_ACTION_PARAM_ALLOWLIST: Readonly<
  Record<string, readonly string[]>
> = {
  [WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION]: [
    "watch_search.result_position",
    "watch_search.result_source",
    "watch_search.result_type",
  ],
}

/**
 * v2 half of the same projection (KTD4, KTD6). The allowlist above is still the
 * ONLY gate on what leaves for Google; this map only says how the already
 * filtered values become a DECLARED contract event.
 *
 * An allowlisted action with no entry here sends nothing to GA under v2 rather
 * than falling back to the v1 helper, because a v1 fallback would mean the
 * generic normalizer, no route context, and no KTD9 seam all running inside a
 * v2 build — exactly the hybrid the flag exists to prevent.
 */
export const GOOGLE_ANALYTICS_ACTION_V2_PROJECTORS: Readonly<
  Record<
    string,
    (params: Record<string, unknown>) => WatchAnalyticsEventInput | null
  >
> = {
  [WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION]: (params) => ({
    type: "search_result_clicked",
    resultPosition: asFiniteNumber(params["watch_search.result_position"]),
    resultSource: asString(params["watch_search.result_source"]),
    resultType: asString(params["watch_search.result_type"]),
  }),
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function lookup<T>(
  map: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
}

function reportGoogleAnalyticsActionProjection(
  name: string,
  context: Record<string, unknown>,
) {
  const allowedKeys = lookup(GOOGLE_ANALYTICS_ACTION_PARAM_ALLOWLIST, name)
  if (allowedKeys == null) return

  const params: Record<string, unknown> = {}
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(context, key)) continue
    params[key] = context[key]
  }

  if (isWatchAnalyticsContractV2Enabled()) {
    const input = lookup(GOOGLE_ANALYTICS_ACTION_V2_PROJECTORS, name)?.(params)
    if (input == null) return
    // Deferred: a search result click navigates client-side, so the document
    // is not replaced before the paint yield runs (R28).
    dispatchWatchAnalyticsEvent(input, { mode: "deferred" })
    return
  }

  // The event still fires with zero parameters when none are present: R25
  // requires the legacy `search_result_clicked` count to stay unchanged.
  reportGoogleAnalyticsEvent(name, params)
}

export function reportDatadogRumAction(
  name: string,
  context: Record<string, unknown>,
) {
  // Guarded: a throw from the GA projection must never stop the Datadog
  // action that follows it, and must never surface into the caller.
  try {
    reportGoogleAnalyticsActionProjection(name, context)
  } catch {
    // Analytics is best-effort on both sides.
  }
  safeReportDatadogRum("action", () => datadogRum.addAction(name, context))
}

type DatadogRumUser = {
  id?: string
  email?: string
  name?: string
}

export function identifyDatadogRumUser(user: DatadogRumUser | undefined) {
  const id = user?.id?.trim()
  if (!user || !id) {
    clearDatadogRumUser()
    return
  }

  const email = user.email?.trim() || undefined
  const name = user.name?.trim() || undefined
  safeReportDatadogRum("user", () =>
    datadogRum.setUser({
      id,
      email,
      name,
    }),
  )
}

export function clearDatadogRumUser() {
  safeReportDatadogRum("user", () => datadogRum.clearUser())
}

function safeReportDatadogRum(
  kind: "action" | "error" | "user",
  report: () => void,
) {
  try {
    report()
  } catch (reportError) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`[datadog-rum] failed to report ${kind}:`, reportError)
    }
  }
}

export default function DatadogRum() {
  const isInitialized = useRef(false)

  useEffect(() => {
    if (isInitialized.current) return

    const config = getDatadogRumInitConfig()
    if (config == null) return

    try {
      datadogRum.init(config)
      isInitialized.current = true
    } catch (error) {
      console.error("[datadog-rum] failed to initialize:", error)
    }
  }, [])

  return null
}
