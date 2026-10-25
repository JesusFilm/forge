import { useEffect, useRef } from "react"
import { usePathname, useSegments } from "expo-router"

import {
  isDatadogProvisioned,
  isSheetViewRoute,
  resolveViewName,
  startDatadogView,
} from "../lib/datadog"

/**
 * Starts a RUM view per route change (name = route pattern, key = pathname).
 * Renders nothing; a no-op until Datadog is provisioned.
 */
export function DatadogRouteTracker() {
  const pathname = usePathname()
  const segments = useSegments()
  // Keyed on the resolved view key: useSegments identity can churn per render,
  // and restarting the active view on re-render would reset its timings.
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    // The view key IS the pathname, so the ref-compare runs before any work.
    if (lastKeyRef.current === pathname) return
    // Sheets stay inside the view that opened them. lastKeyRef is deliberately
    // NOT advanced, so dismissing back to that same route is still a no-op and
    // the underlying view keeps running uninterrupted.
    if (isSheetViewRoute(segments)) return
    if (!isDatadogProvisioned()) return
    const { key, name } = resolveViewName(segments, pathname)
    lastKeyRef.current = key
    startDatadogView(key, name)
  }, [pathname, segments])

  return null
}
