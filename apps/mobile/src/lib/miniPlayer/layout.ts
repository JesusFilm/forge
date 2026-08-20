/**
 * Corner-snap geometry for the floating window (R2, R7), pure arithmetic over
 * the screen, the safe-area insets and the app's LIVE chrome heights.
 *
 * KTD6: the window's minimum size derives from its controls. The controls
 * overlay the video's top corners, so the floor is the larger of two
 * accessibility-minimum targets plus the gap between them and the video area's
 * own minimum width — a maximum, not a sum. Every corner frame insets inside
 * both the live top chrome and the live bottom chrome, so all four corners stay
 * reachable and none covers a chrome tap target.
 */

import { PLAYER_HEIGHT_RATIO } from "../playerLayout"

export type MiniPlayerCorner =
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight"

export type MiniPlayerScreen = { width: number; height: number }

export type MiniPlayerInsets = {
  top: number
  right: number
  bottom: number
  left: number
}

/** Live chrome heights: a header or floating back button above, a tab bar or
 *  action bar below. Zero on a full-bleed screen. */
export type MiniPlayerChrome = { top: number; bottom: number }

export type MiniPlayerFrame = {
  corner: MiniPlayerCorner
  x: number
  y: number
  width: number
  height: number
}

/** iOS asks 44pt and Android 48dp; the larger satisfies both platforms. */
export const ACCESSIBILITY_MIN_TARGET = 48

/** Clear space between the play-pause and dismiss controls. */
export const CONTROL_GAP = 8

/** Below this the video reads as a coloured rectangle rather than content. */
export const MIN_VIDEO_WIDTH = 160

/** Window width as a share of the screen width, before the KTD6 floor. */
export const WINDOW_WIDTH_FRACTION = 0.42

/** Gap between the window and the safe-area or chrome edge it sits against. */
export const WINDOW_EDGE_MARGIN = 12

/**
 * Corner preference. The app's focusable chrome — floating back buttons,
 * headers, the hero's overlay controls — sits along the top and left edges, so
 * the bottom-right corner obscures no focusable control.
 */
export const CORNER_PREFERENCE = [
  "bottomRight",
  "bottomLeft",
  "topRight",
  "topLeft",
] as const satisfies readonly MiniPlayerCorner[]

export const DEFAULT_CORNER: MiniPlayerCorner = CORNER_PREFERENCE[0]

export type MiniPlayerSizeConfig = {
  minTouchTarget?: number
  controlGap?: number
  minVideoWidth?: number
  widthFraction?: number
  margin?: number
}

export type MiniPlayerLayoutConfig = MiniPlayerSizeConfig & {
  screen: MiniPlayerScreen
  insets: MiniPlayerInsets
  chrome: MiniPlayerChrome
  /** Reserved for a corner with insufficient clearance; the rest stay reachable. */
  excludedCorners?: readonly MiniPlayerCorner[]
  /** Share of the travel between the two snap positions on each axis. */
  snapBias?: number
}

/** KTD6's floor: a MAXIMUM of the control row and the video's own minimum. */
export function miniPlayerMinWidth(config: MiniPlayerSizeConfig = {}): number {
  const target = config.minTouchTarget ?? ACCESSIBILITY_MIN_TARGET
  const gap = config.controlGap ?? CONTROL_GAP
  const videoWidth = config.minVideoWidth ?? MIN_VIDEO_WIDTH
  return Math.max(target * 2 + gap, videoWidth)
}

export function miniPlayerWindowSize(config: MiniPlayerLayoutConfig): {
  width: number
  height: number
} {
  const margin = config.margin ?? WINDOW_EDGE_MARGIN
  const floor = miniPlayerMinWidth(config)
  const available =
    config.screen.width - config.insets.left - config.insets.right - margin * 2
  const preferred = Math.round(
    config.screen.width * (config.widthFraction ?? WINDOW_WIDTH_FRACTION),
  )
  // The floor wins on a screen too narrow to honour it: an unusable control row
  // is a worse failure than a window that overhangs its margin.
  const width = Math.max(floor, Math.min(preferred, available))
  return { width, height: Math.round(width * PLAYER_HEIGHT_RATIO) }
}

type SnapBounds = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

function snapBounds(config: MiniPlayerLayoutConfig): SnapBounds {
  const margin = config.margin ?? WINDOW_EDGE_MARGIN
  const { width, height } = miniPlayerWindowSize(config)
  return {
    left: config.insets.left + margin,
    right: config.screen.width - config.insets.right - margin - width,
    top: config.insets.top + config.chrome.top + margin,
    bottom:
      config.screen.height -
      config.insets.bottom -
      config.chrome.bottom -
      margin -
      height,
    width,
    height,
  }
}

export function miniPlayerCornerFrame(
  config: MiniPlayerLayoutConfig,
  corner: MiniPlayerCorner,
): MiniPlayerFrame {
  const bounds = snapBounds(config)
  const onLeft = corner === "topLeft" || corner === "bottomLeft"
  const onTop = corner === "topLeft" || corner === "topRight"
  return {
    corner,
    x: onLeft ? bounds.left : bounds.right,
    y: onTop ? bounds.top : bounds.bottom,
    width: bounds.width,
    height: bounds.height,
  }
}

/**
 * The corners a drag may settle in, in preference order. An exclusion that
 * would empty the set is ignored down to the default corner — the window must
 * always have somewhere to land.
 */
export function allowedCorners(
  config: MiniPlayerLayoutConfig,
): readonly MiniPlayerCorner[] {
  const excluded = new Set(config.excludedCorners ?? [])
  const allowed = CORNER_PREFERENCE.filter((corner) => !excluded.has(corner))
  return allowed.length > 0 ? allowed : [DEFAULT_CORNER]
}

export function miniPlayerCornerFrames(
  config: MiniPlayerLayoutConfig,
): MiniPlayerFrame[] {
  return allowedCorners(config).map((corner) =>
    miniPlayerCornerFrame(config, corner),
  )
}

export function defaultCornerFrame(
  config: MiniPlayerLayoutConfig,
): MiniPlayerFrame {
  return miniPlayerCornerFrame(config, allowedCorners(config)[0])
}

/**
 * Settle a drag release into a corner (R2). `origin` is the window's top-left,
 * which is what the drag's `Animated.ValueXY` holds. The threshold is the
 * midpoint of each axis's own travel, so an asymmetric safe area does not bias
 * the snap. A release in an excluded corner's quadrant lands in the nearest
 * corner that is allowed.
 */
export function snapToCorner(
  config: MiniPlayerLayoutConfig,
  origin: { x: number; y: number },
): MiniPlayerFrame {
  const bounds = snapBounds(config)
  const bias = config.snapBias ?? 0.5
  const xThreshold = bounds.left + (bounds.right - bounds.left) * bias
  const yThreshold = bounds.top + (bounds.bottom - bounds.top) * bias
  const preferred: MiniPlayerCorner =
    origin.y < yThreshold
      ? origin.x < xThreshold
        ? "topLeft"
        : "topRight"
      : origin.x < xThreshold
        ? "bottomLeft"
        : "bottomRight"

  const frames = miniPlayerCornerFrames(config)
  const match = frames.find((frame) => frame.corner === preferred)
  if (match) return match

  let nearest = frames[0]
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const frame of frames) {
    const distance =
      (frame.x - origin.x) * (frame.x - origin.x) +
      (frame.y - origin.y) * (frame.y - origin.y)
    if (distance < nearestDistance) {
      nearest = frame
      nearestDistance = distance
    }
  }
  return nearest
}
