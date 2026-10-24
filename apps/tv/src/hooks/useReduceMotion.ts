import { useEffect, useState } from "react"
import { AccessibilityInfo } from "react-native"

/**
 * Tracks the OS "reduce motion" setting (initial read + live subscription),
 * mirroring VideoPlayer.tsx. Suppresses the hover-preview for reduce-motion
 * users (R4).
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    let mounted = true
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value)
    })
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    )
    return () => {
      mounted = false
      try {
        sub.remove()
      } catch (e) {
        console.error("[useReduceMotion] cleanup failed:", e)
      }
    }
  }, [])
  return reduceMotion
}
