import type { HomeBrowseState } from "./homeScrollState"

/** Focused paging snaps artwork and copy together, keeping activation immediate.
 * Ambient index changes keep the existing serialized animations mounted. */
export function heroPresentationKey(cardId: string | null, focused: boolean) {
  return focused ? `focused:${cardId ?? "empty"}` : "ambient"
}

export function clampHeroIndex(index: number, count: number) {
  return count > 0 ? Math.max(0, Math.min(index, count - 1)) : 0
}

export function shouldRotateHero(
  active: boolean,
  focused: boolean,
  count: number,
) {
  return active && !focused && count > 1
}

/** Home owns Back only while its lower content is the active surface. */
export function shouldReturnHomeToTop(
  active: boolean,
  browseState: HomeBrowseState,
) {
  return active && browseState === "deep"
}

/** Each eligible dwell owns exactly one advance; focus/route changes cancel it. */
export function scheduleHeroRotation(
  active: boolean,
  focused: boolean,
  count: number,
  advance: () => void,
  delayMs: number,
): (() => void) | undefined {
  if (!shouldRotateHero(active, focused, count)) return
  const timer = setTimeout(advance, delayMs)
  return () => clearTimeout(timer)
}

/** tvOS Menu otherwise bypasses JS and exits to the launcher. Claim it only
 * while lower Home owns Back, and release it before top-level platform Back. */
export function claimHomeMenuKey(
  active: boolean,
  browseState: HomeBrowseState,
  tvOS: boolean,
  controls: { enableTVMenuKey: () => void; disableTVMenuKey: () => void },
): (() => void) | undefined {
  if (!tvOS || !shouldReturnHomeToTop(active, browseState)) return
  controls.enableTVMenuKey()
  let released = false
  return () => {
    if (released) return
    released = true
    controls.disableTVMenuKey()
  }
}
