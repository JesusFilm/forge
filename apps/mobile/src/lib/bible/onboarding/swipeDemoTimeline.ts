// The first-run swipe demo's timeline (feat-551 R16), in milliseconds on one
// clock. Each cycle shows a verse swipe, then a chapter swipe. A pause follows
// each cycle, and after the last pause the whole demo fades out.

/** A finger and its caption fade in or out over this time. */
export const SWIPE_DEMO_PART_FADE_MS = 300
/** The finger moves over this time. */
export const SWIPE_DEMO_PART_MOVE_MS = 1000
/** Nothing shows between the verse swipe and the chapter swipe. */
export const SWIPE_DEMO_PART_GAP_MS = 300
/** The owner asked for at least three cycles (2026-09-25). */
export const SWIPE_DEMO_CYCLES = 3
/** Nothing shows after each cycle. */
export const SWIPE_DEMO_PAUSE_MS = 500
/** The demo fades out over this time after the last pause. */
export const SWIPE_DEMO_FADE_OUT_MS = 400

const PART_MS = 2 * SWIPE_DEMO_PART_FADE_MS + SWIPE_DEMO_PART_MOVE_MS
/** One verse swipe and one chapter swipe, without the pause. */
export const SWIPE_DEMO_CYCLE_MS = 2 * PART_MS + SWIPE_DEMO_PART_GAP_MS
const PERIOD_MS = SWIPE_DEMO_CYCLE_MS + SWIPE_DEMO_PAUSE_MS
/** The whole demo, from the first fade-in to the end of the fade-out. */
export const SWIPE_DEMO_MS =
  SWIPE_DEMO_CYCLES * PERIOD_MS + SWIPE_DEMO_FADE_OUT_MS

export type SwipeDemoPart = "verse" | "chapter"

/** Keyframes for `Animated.Value.interpolate` on the demo clock. */
export type Keyframes = { inputRange: number[]; outputRange: number[] }

/** Fade in, start moving, stop moving, fade out: one part in one cycle. */
function partPoints(part: SwipeDemoPart, cycle: number): number[] {
  const start =
    cycle * PERIOD_MS +
    (part === "verse" ? 0 : PART_MS + SWIPE_DEMO_PART_GAP_MS)
  const moveFrom = start + SWIPE_DEMO_PART_FADE_MS
  const moveTo = moveFrom + SWIPE_DEMO_PART_MOVE_MS
  return [start, moveFrom, moveTo, moveTo + SWIPE_DEMO_PART_FADE_MS]
}

function everyCycle(
  part: SwipeDemoPart,
  values: [number, number, number, number],
): Keyframes {
  const inputRange: number[] = []
  const outputRange: number[] = []
  for (let cycle = 0; cycle < SWIPE_DEMO_CYCLES; cycle += 1) {
    inputRange.push(...partPoints(part, cycle))
    outputRange.push(...values)
  }
  return { inputRange, outputRange }
}

/** The part is visible only while it plays, in every cycle. */
export function partOpacityKeyframes(part: SwipeDemoPart): Keyframes {
  return everyCycle(part, [0, 1, 1, 0])
}

/** The finger moves from `+travel / 2` to `-travel / 2` in every cycle. It
 *  goes back to the start while it is hidden. */
export function partTravelKeyframes(
  part: SwipeDemoPart,
  travel: number,
): Keyframes {
  return everyCycle(part, [travel / 2, travel / 2, -travel / 2, -travel / 2])
}

/** The whole demo stays until the last pause ends, then fades out. */
export function demoOpacityKeyframes(): Keyframes {
  const fadeFrom = SWIPE_DEMO_MS - SWIPE_DEMO_FADE_OUT_MS
  return { inputRange: [0, fadeFrom, SWIPE_DEMO_MS], outputRange: [1, 1, 0] }
}
