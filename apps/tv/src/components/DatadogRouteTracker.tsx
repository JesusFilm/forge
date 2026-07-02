import { useEffect, useRef } from "react"
import { usePathname, useSegments } from "expo-router"

import {
  getDatadogRumConfig,
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
    if (getDatadogRumConfig() == null) return
    const { key, name } = resolveViewName(segments, pathname)
    if (lastKeyRef.current === key) return
    lastKeyRef.current = key
    startDatadogView(key, name)
  }, [pathname, segments])

  return null
}
