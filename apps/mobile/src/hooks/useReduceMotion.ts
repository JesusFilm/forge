import { useEffect, useState } from "react"
import { AccessibilityInfo } from "react-native"

/**
 * The OS "reduce motion" setting, mirroring `apps/tv`'s hook. False until the
 * async read lands, and false if it rejects: a failed accessibility query must
 * not take down the surface that consumes it.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    // Per effect run, not a hook-lifetime ref: StrictMode runs setup ->
    // cleanup -> setup on one instance, and a flag outliving the effect would
    // stay false after the first cleanup and discard every later read.
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
