import { useNavigation } from "expo-router"
import { useEffect, useState } from "react"

export type ExploreFocus = {
  /** The tab is on screen now. */
  focused: boolean
  /** The tab has been on screen at least once. It never goes back to false. */
  hasFocused: boolean
}

/**
 * R46's first-focus latch, on Home's focus pattern. iOS NativeTabs render every
 * tab's content at launch (KTD13), so no Explore player, timer, or request may
 * start before `hasFocused`.
 */
export function useExploreFocus(): ExploreFocus {
  const navigation = useNavigation()
  // Seeded from the navigator, as Home is: a deep link mounts the tab focused.
  const [focused, setFocused] = useState(() => navigation.isFocused())
  const [hasFocused, setHasFocused] = useState(focused)

  useEffect(() => {
    const markFocused = () => {
      setFocused(true)
      setHasFocused(true)
    }
    const unsubscribeFocus = navigation.addListener("focus", markFocused)
    const unsubscribeBlur = navigation.addListener("blur", () => {
      setFocused(false)
    })
    // A focus between the first render and this effect sends no event here.
    if (navigation.isFocused()) markFocused()
    return () => {
      unsubscribeFocus()
      unsubscribeBlur()
    }
  }, [navigation])

  return { focused, hasFocused }
}
