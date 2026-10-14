// When and how the film light leaks flash over the Home Pause card. The
// component draws them; this module only decides the timing and the leak.

/** A filmed leak from scripts/build-pause-light-leaks.sh, from the right, or
 *  mirrored so that it comes from the left. */
export type LightLeakShape = "sweep" | "band" | "sweep-left" | "band-left"

export const LIGHT_LEAK_SHAPES: readonly LightLeakShape[] = [
  "sweep",
  "band",
  "sweep-left",
  "band-left",
]

/** The quiet time before each flash. */
export const LIGHT_LEAK_GAP_MS = { min: 5000, max: 11000 } as const

/** One flash, from dark to dark. */
export const LIGHT_LEAK_FLASH_MS = 2400

/** Opacity over one flash: a fast rise, one flicker, then a slow fade. One
 *  timing drives it, because a native Animated.sequence can fail on Fabric. */
export const LIGHT_LEAK_CURVE = {
  inputRange: [0, 0.1, 0.16, 0.24, 0.5, 1],
  outputRange: [0, 1, 0.55, 0.95, 0.75, 0],
} as const

/** The leak's second frame fades in over its first, so the light moves. */
export const LIGHT_LEAK_CROSSFADE = {
  inputRange: [0.1, 0.7],
  outputRange: [0, 1],
} as const

export function lightLeakGapMs(random: () => number = Math.random): number {
  const { min, max } = LIGHT_LEAK_GAP_MS
  return Math.round(min + random() * (max - min))
}

/** A leak other than the last one, so two flashes in a row differ. */
export function pickLightLeakShape(
  previous: LightLeakShape | null,
  random: () => number = Math.random,
): LightLeakShape {
  const choices = LIGHT_LEAK_SHAPES.filter((shape) => shape !== previous)
  const at = Math.min(Math.floor(random() * choices.length), choices.length - 1)
  return choices[at]!
}

/** The leaks need a screen blend, which React Native gives only on iOS and
 *  on Android 10 (API 29) and later. */
export function lightLeaksSupported(
  os: string,
  version: string | number,
): boolean {
  return os !== "android" || Number(version) >= 29
}
