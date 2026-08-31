"use client"

import Script from "next/script"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef } from "react"

import { env } from "@/env"

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

export function GoogleAnalyticsScripts({
  measurementId,
}: {
  measurementId: string
}) {
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
window.gtag('config', ${JSON.stringify(measurementId)});
        `}
      </Script>
    </>
  )
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

export default function GoogleAnalytics({
  analyticsConsent = false,
}: {
  analyticsConsent?: boolean
}) {
  if (!analyticsConsent) return null
  const measurementId = getGoogleAnalyticsMeasurementId()
  if (measurementId == null) return null

  return (
    <>
      <GoogleAnalyticsScripts measurementId={measurementId} />
      <Suspense fallback={null}>
        <GoogleAnalyticsRouteChanges measurementId={measurementId} />
      </Suspense>
    </>
  )
}
