// Pure decision for the showcase language tag's per-hop transition (R8). React-free and
// colocated so it's unit-testable — apps/tv has no render harness by convention (mirrors
// audioFade.ts backing ReelPlayer); ExcerptChrome keeps only the Animated wiring.

export type LanguageDissolve = {
  /** The language the live pill shows — always the incoming one. */
  current: string | null
  /** The outgoing pill that fades out over `current`, or null (no dissolve / cleared). */
  exiting: string | null
  /** Whether to run the fade-out animation on `exiting`. */
  crossfade: boolean
}

/**
 * Decide the tag's transition from the previously-shown language to the incoming one. A real
 * language change within the SAME centerpiece crossfades; a new excerpt or reduce-motion
 * adopts the language with no fade; and a non-change (any effect re-render that is not a
 * language change) clears `exiting`, so a mid-dissolve re-render can't freeze the outgoing
 * pill on screen.
 */
export function resolveLanguageDissolve(args: {
  previous: string | null
  next: string | null
  sameExcerpt: boolean
  reduceMotion: boolean
}): LanguageDissolve {
  const { previous, next, sameExcerpt, reduceMotion } = args
  const crossfade =
    next !== previous &&
    sameExcerpt &&
    !reduceMotion &&
    previous != null &&
    next != null
  return { current: next, exiting: crossfade ? previous : null, crossfade }
}
