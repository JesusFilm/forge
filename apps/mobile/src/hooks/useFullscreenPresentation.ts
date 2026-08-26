import { useCallback, useEffect, useState } from "react"
import { AppState, BackHandler } from "react-native"
import { useNavigation } from "expo-router"

import { enterFullscreenLandscape, exitToPortrait } from "../lib/orientation"

/**
 * The fullscreen apparatus the watch + series screens share (todo 014):
 * orientation lock, iOS back-swipe gating, Android back, foreground re-lock,
 * and the unmount portrait net.
 */
export function useFullscreenPresentation() {
  const navigation = useNavigation()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), [])

  // The expo-screen-orientation lock is the ONLY orientation writer here. A
  // react-native-screens `orientation` screen option makes expo defer to a VC
  // chain the dev-client launcher breaks, and UIKit then refuses the rotation.
  useEffect(() => {
    if (isFullscreen) void enterFullscreenLandscape()
    else void exitToPortrait()
  }, [isFullscreen])

  // Back-swipe off while fullscreen — the route cannot pop mid-fullscreen.
  // Inline it stays ON: the scrubber yields the edge strip instead of racing
  // the recognizer (src/lib/backSwipe.ts), so no chrome-driven hold is needed.
  const gestureEnabled = !isFullscreen
  useEffect(() => {
    const apply = () => {
      navigation.setOptions({ gestureEnabled })
      // The dismissing pop belongs to the PARENT stack (watch/series are
      // nested) and react-native-screens consults only that stack's own top
      // screen — a self-only write is inert against it.
      navigation.getParent()?.setOptions({ gestureEnabled })
    }
    // Focus-gated: a covered screen must not clobber the top screen's options;
    // the focus event replays this screen's truth on return.
    if (navigation.isFocused()) apply()
    return navigation.addListener("focus", apply)
  }, [gestureEnabled, navigation])

  // While fullscreen: Android hardware back exits fullscreen (not the route),
  // and a foreground resume re-asserts the landscape lock the OS may have
  // dropped on background.
  useEffect(() => {
    if (!isFullscreen) return
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      setIsFullscreen(false)
      return true
    })
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void enterFullscreenLandscape()
    })
    return () => {
      back.remove()
      app.remove()
    }
  }, [isFullscreen])

  // Safety net: re-lock portrait if the screen unmounts while still fullscreen
  // (deep navigation away), so no other screen inherits landscape.
  useEffect(() => {
    return () => {
      void exitToPortrait()
    }
  }, [])

  return { isFullscreen, toggleFullscreen }
}
