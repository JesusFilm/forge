"use client"

import { useEffect, useState } from "react"

function getFullscreenElement(): HTMLElement | null {
  if (typeof document === "undefined") return null
  return (document.fullscreenElement ??
    (
      document as Document & {
        webkitFullscreenElement?: Element | null
      }
    ).webkitFullscreenElement ??
    null) as HTMLElement | null
}

// Single source of truth for fullscreen state — previously HeroPlayer and
// HeroPlayerControls each installed their own listener with independent
// state, which could desync if chrome revealed mid-fullscreen (the
// HeroPlayerControls instance was created after the fullscreenchange event
// had fired, so its `isFullscreen` started at `false`). Lifting the
// detection here keeps both consumers reading from the same value.
//
// Notes:
//   - iOS Safari does NOT fire `fullscreenchange` on a wrapper `<div>`
//     entering fullscreen via JS — only the native video element fires it.
//     So this hook always reports `false` on iOS for our wrapper-based
//     fullscreen. The globe-hide and portal-target swap become no-ops
//     there, which is acceptable since iOS uses its own native fullscreen
//     chrome anyway.
//   - SSR-safe: guarded with `typeof document === "undefined"`.
export function useIsFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    if (typeof document === "undefined") return
    function updateFullscreen() {
      setIsFullscreen(getFullscreenElement() != null)
    }
    updateFullscreen()
    document.addEventListener("fullscreenchange", updateFullscreen)
    document.addEventListener("webkitfullscreenchange", updateFullscreen)
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreen)
      document.removeEventListener("webkitfullscreenchange", updateFullscreen)
    }
  }, [])
  return isFullscreen
}

export function useFullscreenPortalContainer(): HTMLElement | null {
  const isFullscreen = useIsFullscreen()
  return isFullscreen ? getFullscreenElement() : null
}
