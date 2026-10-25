"use client"

import { useEffect, useState } from "react"

import type { WatchGrowProps } from "./WatchGrow"
import { getLoadedWatchGrow, loadWatchGrow } from "./watch-grow-loader"

/**
 * Grow has no server-rendered role content on these statically cached pages.
 * Commit the intent-loaded module directly instead of suspending/revealing it:
 * React's nested lazy reveal throttle otherwise delays a cold lesson return
 * even after all required chunks have arrived. No curriculum is eager here.
 */
export function WatchGrowLoader(props: WatchGrowProps) {
  const [Grow, setGrow] = useState(getLoadedWatchGrow)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (Grow) return
    let cancelled = false
    void loadWatchGrow().then(
      (component) => {
        if (!cancelled) setGrow(() => component)
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason)
      },
    )
    return () => {
      cancelled = true
    }
  }, [Grow])
  if (error) throw error
  return Grow ? <Grow {...props} /> : null
}
