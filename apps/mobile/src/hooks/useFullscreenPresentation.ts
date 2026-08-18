import { useCallback, useEffect, useState } from "react"
import { AppState, BackHandler } from "react-native"
import { useNavigation } from "expo-router"

import { enterFullscreenLandscape, exitToPortrait } from "../lib/orientation"

/**
 * The fullscreen apparatus the watch + series screens share (todo 014):
 * orientation lock, iOS back-swipe gating (fullscreen + chrome hold), Android
 * back, foreground re-lock, and the unmount portrait net.
 */
export function useFullscreenPresentation() {
  const navigation = useNavigation()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [backSwipeHeld, setBackSwipeHeld] = useState(false)
  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), [])

  // MUST name the same single orientation as enterFullscreenLandscape's
  // LANDSCAPE_RIGHT lock: when the two layers disagree, each geometry request
  // falls outside the other's mask and iOS rejects the rotation.
  useEffect(() => {
    navigation.setOptions({
      orientation: isFullscreen ? "landscape_right" : "portrait",
    })
    if (isFullscreen) void enterFullscreenLandscape()
    else void exitToPortrait()
  }, [isFullscreen, navigation])

  // Back-swipe off while fullscreen (can't pop mid-fullscreen) or while the
  // player chrome is up — a rightward scrub on the seek bar is the same touch
  // the native pop recognizer claims, and it claims it before JS ever runs.
  const gestureEnabled = !isFullscreen && !backSwipeHeld
  useEffect(() => {
    const apply = () => {
      navigation.setOptions({ gestureEnabled })
      // The dismissing pop belongs to the PARENT stack (watch/series are
      // nested) and react-native-screens consults only that stack's own top
      // screen — a self-only write is inert against it.
      navigation.getParent()?.setOptions({ gestureEnabled })
    }
    // Focus-gated: a covered screen's chrome timers must not clobber the top
    // screen's options; the focus event replays this screen's truth on return.
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

  return { isFullscreen, toggleFullscreen, setBackSwipeHeld }
}
