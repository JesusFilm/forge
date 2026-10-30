import type { ComponentType } from "react"

import { hasWatchGrowReturnIntent } from "@/lib/watch-grow-return-intent"
import type { WatchGrowProgressCourseProps } from "./WatchGrowProgressCourse"

let loadedGrow: typeof import("./WatchGrow").WatchGrow | null = null
let pendingGrow: Promise<typeof import("./WatchGrow").WatchGrow> | null = null

export function getLoadedWatchGrow() {
  return loadedGrow
}

let loadedCourse: ComponentType<WatchGrowProgressCourseProps> | null = null
let pendingCourse: Promise<ComponentType<WatchGrowProgressCourseProps>> | null =
  null

export function getLoadedWatchGrowCourse() {
  return loadedCourse
}

export function loadWatchGrowCourse() {
  if (loadedCourse) return Promise.resolve(loadedCourse)
  if (!pendingCourse) {
    pendingCourse = import("./WatchGrowProgressCourse").then(
      (module) => {
        loadedCourse = module.WatchGrowProgressCourse
        return loadedCourse
      },
      (error: unknown) => {
        pendingCourse = null
        throw error
      },
    )
  }
  return pendingCourse
}

/**
 * A supported lesson return already expresses course intent. Resolve its
 * persona and course together, avoiding a second post-commit import/reveal.
 * Ordinary entry still loads only the persona. A preload failure leaves the
 * course's existing local error/retry/PDF fallback in charge.
 */
export function loadWatchGrow() {
  if (loadedGrow) return Promise.resolve(loadedGrow)
  if (!pendingGrow) {
    pendingGrow = Promise.all([
      import("./WatchGrow"),
      hasWatchGrowReturnIntent()
        ? loadWatchGrowCourse().catch(() => null)
        : null,
    ]).then(
      ([module]) => {
        loadedGrow = module.WatchGrow
        return loadedGrow
      },
      (error: unknown) => {
        pendingGrow = null
        throw error
      },
    )
  }
  return pendingGrow
}

/** Static pages share HTML across queries. Prewarm only the explicit supported
 * return, and only if the server actually rendered its audience surface.
 * Importing modules does not mount the course or read/write account progress.
 */
export function preloadWatchGrowReturn() {
  if (
    hasWatchGrowReturnIntent() &&
    document.querySelector('[data-testid="watch-next-steps"]') &&
    new URLSearchParams(window.location.search).get("as") === "grow"
  ) {
    void loadWatchGrow().catch(() => {
      // The mounted host retries and owns the existing error boundary.
    })
  }
}
