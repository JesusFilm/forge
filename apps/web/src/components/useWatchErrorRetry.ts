"use client"

import { useCallback, useEffect, useRef } from "react"

/** Marks a route error boundary's retry button so a re-failed retry can refocus it. */
export const WATCH_ERROR_RETRY_ATTRIBUTE = "data-watch-error-retry"

/**
 * Wraps a Next.js error boundary's `reset()` so keyboard and screen-reader
 * users keep their place (feat-774). Pressing the retry button removes it,
 * so focus would fall to `<body>`. After the boundary unmounts:
 *
 * - if the retry failed again, focus the new error view's retry button;
 * - otherwise focus the page's main landmark once, as `tabIndex=-1` so it
 *   does not join the tab order, without a page-sized focus ring.
 *
 * Nothing moves when focus already landed somewhere else, so a user who has
 * moved on is never pulled back.
 */
export function useWatchErrorRetry(reset: () => void): () => void {
  const retrying = useRef(false)

  useEffect(
    () => () => {
      // Read at real unmount only. StrictMode's dev re-run happens before any
      // click, while this is still false.
      if (!retrying.current) return
      window.requestAnimationFrame(restoreFocusAfterRetry)
    },
    [],
  )

  return useCallback(() => {
    retrying.current = true
    reset()
  }, [reset])
}

export function restoreFocusAfterRetry(): void {
  const active = document.activeElement
  if (active && active !== document.body) return

  const retry = document.querySelector<HTMLElement>(
    `[${WATCH_ERROR_RETRY_ATTRIBUTE}]`,
  )
  if (retry) {
    retry.focus()
    return
  }

  // `#watch-main-content` is the skip-link target where the page shell
  // provides one; otherwise the recovered page's own landmark.
  const main =
    document.getElementById("watch-main-content") ??
    document.querySelector<HTMLElement>("main")
  if (!main) return
  if (!main.hasAttribute("tabindex")) {
    main.tabIndex = -1
    // A focus ring around the whole page reads as a glitch; the next Tab
    // still shows the ring on the first control.
    main.classList.add("outline-none")
  }
  main.focus({ preventScroll: true })
}
