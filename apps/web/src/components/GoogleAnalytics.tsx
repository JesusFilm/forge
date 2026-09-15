"use client"

import Script from "next/script"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef } from "react"

import { env } from "@/env"
import {
  emitWatchAnalyticsPageView,
  isWatchAnalyticsContractV2Enabled,
} from "@/lib/watch-analytics-contract"
import { resolveWatchAnalyticsRoute } from "@/lib/watch-analytics-route"

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: [string, ...unknown[]]) => void
  }
}

type GoogleAnalyticsEventParams = Record<string, unknown>

export function getGoogleAnalyticsMeasurementId(): string | null {
  const measurementId = env.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID?.trim()
  return measurementId ? measurementId : null
}

function normalizeGoogleAnalyticsEventName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^watch_/, "")
    .slice(0, 40)
  return normalized || "event"
}

function normalizeGoogleAnalyticsParamName(name: string): string | null {
  const normalized = name
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^watch_/, "")
    .replace(/^search_/, "")
    .slice(0, 40)
  return normalized || null
}

function cleanGoogleAnalyticsEventParams(
  params: GoogleAnalyticsEventParams,
): Record<string, boolean | number | string> {
  return Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => {
      if (
        typeof value !== "boolean" &&
        typeof value !== "number" &&
        typeof value !== "string"
      ) {
        return []
      }

      const normalizedKey = normalizeGoogleAnalyticsParamName(key)
      return normalizedKey ? [[normalizedKey, value]] : []
    }),
  )
}

export function reportGoogleAnalyticsEvent(
  name: string,
  params: GoogleAnalyticsEventParams = {},
) {
  if (typeof window === "undefined") return
  if (typeof window.gtag !== "function") return

  window.gtag(
    "event",
    normalizeGoogleAnalyticsEventName(name),
    cleanGoogleAnalyticsEventParams(params),
  )
}

function pagePathFromLocation(pathname: string, queryString: string): string {
  return queryString ? `${pathname}?${queryString}` : pathname
}

/**
 * R8/KTD2 — under v2 this collector OWNS page views, so the repo's Google tag
 * is configured with `send_page_view: false` and `GoogleAnalyticsPageViews`
 * emits every `page_view` explicitly.
 *
 * OPERATOR PREREQUISITE, not enforceable from this repository: GA4 Enhanced
 * Measurement has a separate "Page changes based on browser history events"
 * option that is a SECOND collector for SPA page views. Leaving it on while v2
 * is enabled double-counts every client navigation. Disable only that option —
 * outbound-click and file-download measurement stay on, because the Watch
 * download handoff is a programmatic click on a synthesized anchor pointing at
 * an extensionless same-origin route that Enhanced Measurement cannot match.
 * The setting is property-wide rather than Watch-scoped, so the rollout gate in
 * `docs/operations/watch-ga4-measurement.md` requires evidence that this
 * observer emits page views for representative non-Watch routes first.
 */
export function GoogleAnalyticsScripts({
  measurementId,
}: {
  measurementId: string
}) {
  const configOptions = isWatchAnalyticsContractV2Enabled()
    ? `, ${JSON.stringify({ send_page_view: false })}`
    : ""

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
          measurementId,
        )}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics-init" strategy="afterInteractive">
        {`
window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
window.gtag('js', new Date());
window.gtag('config', ${JSON.stringify(measurementId)}${configOptions});
        `}
      </Script>
    </>
  )
}

/**
 * How long the observer keeps retrying while the Google tag is still loading.
 * `afterInteractive` scripts can land well after hydration, and an ad blocker
 * may mean they never do — hence a bounded retry rather than an open loop.
 */
const GOOGLE_TAG_READINESS_POLL_MS = 200
const GOOGLE_TAG_READINESS_MAX_ATTEMPTS = 50

/**
 * The single readiness-aware route observer (KTD2, F1).
 *
 * R6: exactly one `page_view` per committed browser-route key. The dedupe key
 * is U2's `pageViewKey` — committed path plus the sanitized campaign set — so
 * a rerender, a Strict Mode effect replay, a `history.replaceState` query
 * cleanup, and a repeated navigation to the same path all collapse, while two
 * genuinely different routes never do.
 *
 * Only `pageViewKey` is hook-lifetime state, and the effect's cleanup never
 * mutates it: Strict Mode's `setup -> cleanup -> setup` cycle therefore finds
 * the key already recorded and emits nothing on the replay. Everything the
 * cleanup does touch (`cancelled`, `timer`) is effect-local and is recreated
 * fresh by the next setup.
 *
 * While the tag is not ready the LATEST committed context wins: each new route
 * cancels the previous effect's pending retry, so two changes before readiness
 * emit one page view for the last committed state rather than a backlog.
 */
function GoogleAnalyticsPageViews() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryString = useMemo(() => searchParams.toString(), [searchParams])
  const lastPageViewKey = useRef<string | null>(null)

  useEffect(() => {
    const context = resolveWatchAnalyticsRoute({
      pathname,
      search: queryString,
    })

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const emitWhenReady = () => {
      if (cancelled) return

      if (typeof window.gtag !== "function") {
        attempts += 1
        if (attempts > GOOGLE_TAG_READINESS_MAX_ATTEMPTS) return
        timer = setTimeout(emitWhenReady, GOOGLE_TAG_READINESS_POLL_MS)
        return
      }

      if (lastPageViewKey.current === context.pageViewKey) return
      lastPageViewKey.current = context.pageViewKey

      // R7: `page_referrer` is supplied explicitly. Left to gtag it would be
      // `document.referrer` verbatim, which R19's full-referrer ban forbids.
      emitWatchAnalyticsPageView(context, {
        referrer:
          typeof document === "undefined" ? undefined : document.referrer,
      })
    }

    emitWhenReady()

    return () => {
      cancelled = true
      if (timer != null) clearTimeout(timer)
    }
  }, [pathname, queryString])

  return null
}

function GoogleAnalyticsRouteChanges({
  measurementId,
}: {
  measurementId: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const previousPagePath = useRef<string | null>(null)
  const queryString = useMemo(() => searchParams.toString(), [searchParams])

  useEffect(() => {
    const pagePath = pagePathFromLocation(pathname, queryString)
    if (previousPagePath.current == null) {
      previousPagePath.current = pagePath
      return
    }
    if (previousPagePath.current === pagePath) return
    if (typeof window.gtag !== "function") return

    window.gtag("config", measurementId, { page_path: pagePath })
    previousPagePath.current = pagePath
  }, [measurementId, pathname, queryString])

  return null
}

/**
 * KTD6 — the flag selects the COLLECTOR BOUNDARY, not individual events.
 * Exactly one route observer mounts, so v1's `config` calls and v2's explicit
 * `page_view` events can never both run and create duplicate or contextless
 * page identities. Rollback is `NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2=false`
 * through the normal deploy path: no route change, no GA measurement-ID change.
 */
export default function GoogleAnalytics() {
  const measurementId = getGoogleAnalyticsMeasurementId()
  if (measurementId == null) return null

  return (
    <>
      <GoogleAnalyticsScripts measurementId={measurementId} />
      <Suspense fallback={null}>
        {isWatchAnalyticsContractV2Enabled() ? (
          <GoogleAnalyticsPageViews />
        ) : (
          <GoogleAnalyticsRouteChanges measurementId={measurementId} />
        )}
      </Suspense>
    </>
  )
}
