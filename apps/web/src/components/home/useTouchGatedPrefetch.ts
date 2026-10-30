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
 * Intent-gated prefetch for bounded Watch home links such as the category rail.
 * Server HTML and hydration start gated. Hover-capable clients arm eagerly
 * unless the caller opts out with `eagerOnHover: false`, as the category rail
 * does because its compact home band is visible during startup.
 *
 * Keyboard focus and deliberate mouse movement arm only the intended link;
 * touch scrolling does not. Some touch browsers focus a tapped link, while
 * iOS Safari leaves it click-only. The hero "Watch Now" action uses a separate
 * explicit `prefetch={false}` posture that never arms on intent.
 */
export function useTouchGatedPrefetch({
  eagerOnHover = true,
}: { eagerOnHover?: boolean } = {}) {
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
    prefetch:
      (eagerOnHover && hoverCapable) || intentShown
        ? undefined
        : (false as const),
    onFocus: arm,
    onPointerMove,
  }
}
