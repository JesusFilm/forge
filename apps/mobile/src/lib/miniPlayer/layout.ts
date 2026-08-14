// Pure corner-snap geometry for the floating window (R2, R7, KTD6). No
// react-native: the caller passes the live screen size and the live chrome.

export type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight"

export const CORNERS: readonly Corner[] = [
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
]

/**
 * The corner the window opens in. Bottom-right clears the back button (top
 * left of every detail screen) and the hero's Watch Now call to action
 * (centre-left of Home), which are the two focusable controls a default corner
 * could otherwise sit on.
 */
export const DEFAULT_CORNER: Corner = "bottomRight"

/** Platform accessibility minimum for a touch target. */
export const MIN_TOUCH_TARGET = 44
/** Gap between the two controls, and between a control and the window edge. */
export const CONTROL_SPACING = 8
/** Gap between the window and the chrome it insets inside. */
export const WINDOW_MARGIN = 12

/**
 * KTD6: the floor is what the controls need, not a taste judgement. The
 * control row is play-pause + dismiss at the accessibility minimum, with
 * spacing either side and between them.
 */
export const MIN_WINDOW_WIDTH = MIN_TOUCH_TARGET * 2 + CONTROL_SPACING * 3 // 44+44 + 8*3 = 112

/** Share of the screen width the window prefers before the floor applies. */
const PREFERRED_WIDTH_RATIO = 0.42
/** The window never eats more than this much width on a large screen. */
const MAX_WINDOW_WIDTH = 220
const ASPECT_RATIO = 16 / 9

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }

/**
 * Live chrome the window must stay clear of, in pixels from each screen edge.
 * Top is the safe-area inset plus any header; bottom is the safe-area inset
 * plus the tab bar where one is showing.
 */
export type Chrome = {
  top: number
  bottom: number
  left: number
  right: number
}

export function miniPlayerSize(screenWidth: number): Size {
  const width = Math.round(
    Math.min(
      MAX_WINDOW_WIDTH,
      Math.max(MIN_WINDOW_WIDTH, screenWidth * PREFERRED_WIDTH_RATIO),
    ),
  )
  return { width, height: Math.round(width / ASPECT_RATIO) }
}

/** Where the window's top-left sits for a given corner. */
export function cornerOrigin(
  corner: Corner,
  screen: Size,
  window: Size,
  chrome: Chrome,
): Point {
  const left = chrome.left + WINDOW_MARGIN
  const right = screen.width - chrome.right - WINDOW_MARGIN - window.width
  const top = chrome.top + WINDOW_MARGIN
  const bottom = screen.height - chrome.bottom - WINDOW_MARGIN - window.height

  switch (corner) {
    case "topLeft":
      return { x: left, y: top }
    case "topRight":
      return { x: right, y: top }
    case "bottomLeft":
      return { x: left, y: bottom }
    case "bottomRight":
      return { x: right, y: bottom }
  }
}

/**
 * Does this corner have room for the window inside the live chrome? A corner
 * without it is excluded rather than clamped, so the window never ends up
 * half-under a tab bar (R7).
 */
export function cornerHasClearance(
  corner: Corner,
  screen: Size,
  window: Size,
  chrome: Chrome,
): boolean {
  const origin = cornerOrigin(corner, screen, window, chrome)
  const fitsHorizontally =
    origin.x >= chrome.left + WINDOW_MARGIN - 0.5 &&
    origin.x + window.width <= screen.width - chrome.right - WINDOW_MARGIN + 0.5
  const fitsVertically =
    origin.y >= chrome.top + WINDOW_MARGIN - 0.5 &&
    origin.y + window.height <=
      screen.height - chrome.bottom - WINDOW_MARGIN + 0.5
  return fitsHorizontally && fitsVertically
}

/**
 * Corners the window may settle in. `excluded` is the caller's override — KTD6
 * reserves it for a corner with a control the geometry cannot see.
 *
 * With nothing left the list falls back, because a window with nowhere to go is
 * worse than one in a poor corner. Clearance is all-or-nothing (it compares the
 * window against the chrome box, which no corner changes), so that fallback
 * fires on any screen too short for the window — routinely, in landscape with a
 * tall keyboard or sheet. It must therefore respect `excluded`: handing back a
 * corner the caller reserved parks the window on the control they protected,
 * and that corner's own origin can be off-screen. Only a caller who excluded
 * ALL FOUR gets the default.
 */
export function allowedCorners(
  screen: Size,
  window: Size,
  chrome: Chrome,
  excluded: readonly Corner[] = [],
): Corner[] {
  const excludedSet = new Set(excluded)
  const allowed = CORNERS.filter(
    (corner) =>
      !excludedSet.has(corner) &&
      cornerHasClearance(corner, screen, window, chrome),
  )
  if (allowed.length > 0) return allowed
  if (!excludedSet.has(DEFAULT_CORNER)) return [DEFAULT_CORNER]
  return [CORNERS.find((corner) => !excludedSet.has(corner)) ?? DEFAULT_CORNER]
}

/**
 * The corner a drag release settles into: nearest by centre-to-centre
 * distance, over the allowed set only. Ties break in CORNERS order, which
 * keeps the result deterministic for a release exactly on an axis.
 */
export function snapCorner(
  releaseOrigin: Point,
  screen: Size,
  window: Size,
  chrome: Chrome,
  excluded: readonly Corner[] = [],
): Corner {
  const releaseCentre = {
    x: releaseOrigin.x + window.width / 2,
    y: releaseOrigin.y + window.height / 2,
  }

  let best: Corner = DEFAULT_CORNER
  let bestDistance = Number.POSITIVE_INFINITY
  for (const corner of allowedCorners(screen, window, chrome, excluded)) {
    const origin = cornerOrigin(corner, screen, window, chrome)
    const dx = origin.x + window.width / 2 - releaseCentre.x
    const dy = origin.y + window.height / 2 - releaseCentre.y
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = corner
    }
  }
  return best
}
