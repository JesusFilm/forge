// The reader's swipe rules (feat-551 KTD13, R6, R12), after HomeScreen's hero
// swipe: dominance and activation to claim, and a commit on release. Pure, so
// ReaderGestures.tsx only reads touches and calls these.
import { mayStartScrub } from "../../scrubber"
import {
  READER_TOP_BAR_HEIGHT,
  readerFooterHeight,
  type ReaderLayout,
} from "../reader/chrome"
import type { MoveDirection } from "./move"

export const READER_SWIPE = Object.freeze({
  /** Movement along the main axis before the reader claims the touch. */
  activatePx: 12,
  /** The main axis must beat the other axis by this ratio. */
  dominance: 1.5,
  /** The distance at release that commits a move. */
  commitPx: 40,
  /** A shorter drag commits when it is this fast (points per ms)... */
  flickVelocity: 0.3,
  /** ...and at least this long. */
  flickPx: 20,
})

export type Point = { x: number; y: number }

/** A rectangle in reader coordinates (the reader fills the window). */
export type Rect = { x: number; y: number; width: number; height: number }

export type ReaderTouchZones = {
  /** A touch above this line belongs to the top bar. */
  topBarBottom: number
  /** A touch at or below this line belongs to the footer. */
  footerTop: number
  /** The iOS back-swipe strip; 0 when the host has no back swipe. */
  edgeGuardWidth: number
  /** Other controls that own their touches, such as U9's scrubber. */
  excluded: readonly Rect[]
}

export function readerTouchZones(input: {
  layout: ReaderLayout
  safeAreaTop: number
  bottomInset: number
  containerHeight: number
  edgeGuardWidth: number
  excluded?: readonly Rect[]
}): ReaderTouchZones {
  return {
    topBarBottom: input.safeAreaTop + READER_TOP_BAR_HEIGHT,
    footerTop:
      input.containerHeight -
      readerFooterHeight(input.layout) -
      input.bottomInset,
    edgeGuardWidth: input.edgeGuardWidth,
    excluded: input.excluded ?? [],
  }
}

function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  )
}

/** False for a touch that starts where another control or the pop owns it. */
export function mayStartReaderSwipe(
  start: Point,
  zones: ReaderTouchZones,
): boolean {
  // One rule with the scrubber, so the pop and a swipe never share a touch.
  if (!mayStartScrub(start.x, zones.edgeGuardWidth)) return false
  if (start.y < zones.topBarBottom || start.y >= zones.footerTop) return false
  return !zones.excluded.some((rect) => contains(rect, start))
}

/** Where a long verse's scroll view stands; null when the verse fits. */
export type ScrollEdges = { atTop: boolean; atBottom: boolean }

export type SwipeAxis = "verse" | "chapter"

// The axis a drag claims, or null to leave the touch alone. A long verse
// keeps a vertical drag until the drag starts at the edge it moves past.
export function claimSwipe(
  delta: { dx: number; dy: number },
  edges: ScrollEdges | null,
): SwipeAxis | null {
  const across = Math.abs(delta.dx)
  const down = Math.abs(delta.dy)
  const { activatePx, dominance } = READER_SWIPE
  if (down > activatePx && down > across * dominance) {
    if (edges && !(delta.dy < 0 ? edges.atBottom : edges.atTop)) return null
    return "verse"
  }
  if (across > activatePx && across > down * dominance) return "chapter"
  return null
}

// R12: up is the next verse and left is the next chapter. RTL text keeps
// these directions, because the controls stay left-to-right (R32).
export function releaseSwipe(
  axis: SwipeAxis,
  total: { dx: number; dy: number },
  velocity: { vx: number; vy: number },
): { axis: SwipeAxis; direction: MoveDirection } | null {
  const distance = axis === "verse" ? total.dy : total.dx
  const speed = axis === "verse" ? velocity.vy : velocity.vx
  const { commitPx, flickPx, flickVelocity } = READER_SWIPE
  const far = Math.abs(distance) >= commitPx
  const flick =
    Math.abs(distance) >= flickPx &&
    Math.abs(speed) >= flickVelocity &&
    Math.sign(speed) === Math.sign(distance)
  if (!far && !flick) return null
  return { axis, direction: distance < 0 ? "forward" : "back" }
}
