import { useCallback, useEffect, useState } from "react"
import { AppState, BackHandler } from "react-native"
import { useNavigation } from "expo-router"

import { enterFullscreenLandscape, exitToPortrait } from "../lib/orientation"

/**
 * The fullscreen apparatus the watch + series screens share (todo 014):
 * orientation lock, iOS gesture disable, Android back, foreground re-lock, and
 * the unmount portrait net. Routes keep only the zIndex dock (decoder safety).
 */
export function useFullscreenPresentation() {
  const navigation = useNavigation()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), [])

  // Fullscreen: disable iOS edge-swipe back (can't pop mid-fullscreen); the
  // native header stays hidden in both states (route layout) with the floating
  // back button as the affordance. Orientation via screen option + lockAsync.
  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: !isFullscreen,
      // MUST name the same single orientation as enterFullscreenLandscape's
      // LANDSCAPE_RIGHT lock: when the two layers disagree, each geometry
      // request falls outside the other's mask and iOS rejects the rotation.
      orientation: isFullscreen ? "landscape_right" : "portrait",
    })
    if (isFullscreen) void enterFullscreenLandscape()
    else void exitToPortrait()
  }, [isFullscreen, navigation])

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
