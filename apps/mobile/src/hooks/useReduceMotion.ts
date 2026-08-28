import { useEffect, useState } from "react"
import { AccessibilityInfo } from "react-native"

/**
 * The OS "reduce motion" setting: the initial read plus a live subscription.
 *
 * Mirrors `apps/tv/src/hooks/useReduceMotion.ts`. This app inlines the same
 * pattern in four places today; they are deliberately left alone rather than
 * migrated here, which would be unrelated churn.
 *
 * Reports false until the asynchronous read lands, so nothing waits on it. A
 * rejected read leaves it at false: a failed accessibility query must not take
 * the surface that consumes it down.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    // Per effect run, and read from the CALLBACK's own closure — not a
    // hook-lifetime ref. Dev StrictMode runs setup -> cleanup -> setup against
    // the same hook instance, so a flag that outlived the effect would stay
    // false after the first cleanup and discard every later read.
    let active = true

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduceMotion(value)
      })
      .catch(() => {})

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    )

    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  return reduceMotion
}
