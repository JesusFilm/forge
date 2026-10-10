"use client"

import {
  useCallback,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react"

/**
 * A device whose primary pointer can hover precisely — a mouse or trackpad.
 * Touch phones and tablets match neither half, so they stay gated.
 */
export const HOVER_CAPABLE_POINTER_QUERY = "(hover: hover) and (pointer: fine)"

// One MediaQueryList for every gated link, so the dozen-plus links on the home
// page do not each call `matchMedia` on every render. Keyed on the function
// so a replaced `matchMedia` (a test stub) is never answered from a stale list.
let cachedQuery: {
  matchMedia: typeof window.matchMedia
  list: MediaQueryList
} | null = null

function hoverCapableQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null
  if (cachedQuery?.matchMedia !== window.matchMedia) {
    cachedQuery = {
      matchMedia: window.matchMedia,
      list: window.matchMedia(HOVER_CAPABLE_POINTER_QUERY),
    }
  }
  return cachedQuery.list
}

function subscribeToHoverCapability(onChange: () => void): () => void {
  const query = hoverCapableQuery()
  if (!query?.addEventListener) return () => {}
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function isHoverCapableDevice(): boolean {
  return hoverCapableQuery()?.matches === true
}

// The server cannot know the pointer, so server HTML and the hydration pass
// are always gated; a hover-capable client re-renders armed right after.
function serverHoverCapability(): boolean {
  return false
}

/**
 * Prefetch posture for a small, bounded set of Watch home links (the hero
 * "Watch Now" action and the category rail): eager on a hover-capable
 * desktop, intent-gated on touch.
 *
 * On a touch device `next/link`'s viewport prefetch fires one speculative
 * `?_rsc=` document request per visible link, and the hero action re-targets
 * on every advance, so a phone on a slow connection spends its bandwidth on
 * pages nobody asked for while the intro video is still buffering (W-025).
 * The link therefore ships with prefetch off and arms only on a real intent
 * signal — keyboard focus, deliberate mouse movement, or the focus some
 * touch browsers (Android Chrome) give a tapped link; iOS Safari does not
 * focus links on tap, so there it is click-only. Touch users still get the
 * click itself, as with the card latch in `MediaCollection`.
 *
 * Unlike that card latch, a hover-capable device is armed from hydration on,
 * which keeps the eager desktop posture these bounded links already had.
 * Prefetch only ever runs client-side after mount, so the gated server render
 * loses nothing.
 */
export function useTouchGatedPrefetch() {
  const hoverCapable = useSyncExternalStore(
    subscribeToHoverCapability,
    isHoverCapableDevice,
    serverHoverCapability,
  )
  const [intentShown, setIntentShown] = useState(false)

  const arm = useCallback(() => {
    setIntentShown(true)
  }, [])

  // Movement, not entry, and only from a mouse: a touch scroll drags
  // `pointermove` across every link it passes, which is not intent.
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") setIntentShown(true)
  }, [])

  return {
    prefetch: hoverCapable || intentShown ? undefined : (false as const),
    onFocus: arm,
    onPointerMove,
  }
}
