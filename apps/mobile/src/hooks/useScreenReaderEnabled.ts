import { useEffect, useState } from "react"
import { AccessibilityInfo } from "react-native"

/** True while VoiceOver or TalkBack is on (feat-553 KTD14), like
 *  `useReduceMotion`: false until the first read answers, and false if it
 *  rejects, so a failed query never takes the reader down. */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    // Per effect run: StrictMode runs setup -> cleanup -> setup on one
    // instance, so a flag that outlived the effect would drop later reads.
    let active = true

    void AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (active) setEnabled(value)
      })
      .catch(() => {})

    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setEnabled,
    )

    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  return enabled
}
