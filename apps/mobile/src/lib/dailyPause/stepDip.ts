// The dip between two steps of a Pause run. The run fades to its ground, the
// step changes while all is dark, and the next step fades in. Film fades to
// black between scenes, and the curtain already fades the same way.

/** A step of the flow (Continue, a part's end) or a jump (a marker, a pill). */
export type DipKind = "flow" | "jump"

export type DipTiming = {
  /** The fade to the ground. */
  outMs: number
  /** All dark: the step changes in the middle of this. */
  holdMs: number
  /** The fade from the ground into the next step. */
  inMs: number
  totalMs: number
  swapMs: number
}

function timing(outMs: number, holdMs: number, inMs: number): DipTiming {
  return {
    outMs,
    holdMs,
    inMs,
    totalMs: outMs + holdMs + inMs,
    swapMs: outMs + holdMs / 2,
  }
}

export const DIP_TIMINGS: Readonly<Record<DipKind, DipTiming>> = {
  flow: timing(350, 150, 500),
  // A jump answers a tap, so it moves on sooner.
  jump: timing(250, 80, 350),
}

/** Reduce Motion keeps the dip, which only fades, but at the quick length. */
export function dipTiming(kind: DipKind, reduceMotion: boolean): DipTiming {
  return reduceMotion ? DIP_TIMINGS.jump : DIP_TIMINGS[kind]
}

/** Nine sample points per curve, as in the Pause's other native curves. */
const CURVE_POINTS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]

const easeInQuad = (t: number) => t * t
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

/** The veil's opacity over one 0-to-1 clock of the whole dip. The native
 *  driver takes no easing key, so each curve rides in as sample points. */
export function dipOpacityRange({ outMs, holdMs, totalMs }: DipTiming): {
  inputRange: number[]
  outputRange: number[]
} {
  const liftFrom = (outMs + holdMs) / totalMs
  const fadeTo = outMs / totalMs
  const inputRange: number[] = []
  const outputRange: number[] = []
  for (const t of CURVE_POINTS) {
    inputRange.push(t * fadeTo)
    outputRange.push(easeInQuad(t))
  }
  for (const t of CURVE_POINTS) {
    inputRange.push(liftFrom + t * (1 - liftFrom))
    outputRange.push(1 - easeOutCubic(t))
  }
  return { inputRange, outputRange }
}
