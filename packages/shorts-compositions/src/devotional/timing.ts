import type { DevotionalCard } from "./schema"

export type CardFrames = { from: number; durationInFrames: number }

/** Breath pad after each card's audio (~0.4s @ 30fps) so words aren't clipped. */
export const CARD_TAIL_FRAMES = 12

/**
 * Extra hold on the FINAL card after its narration ends (~8s @ 30fps), so the
 * closing card — usually the reflection questions — stays on screen in silence
 * long enough to read and sit with before the video ends.
 */
export const OUTRO_HOLD_FRAMES = 240

/**
 * A held beat at the very start (~1s @ 30fps): the cover is on screen — the
 * logo animating in — before the narration begins (owner ask: voice delay 1s).
 */
export const INTRO_HOLD_FRAMES = 30

/**
 * Option A: frame each card to its OWN audio snippet's exact length. A small
 * `tailFrames` pad per card prevents the next card cutting in on the last word
 * and gives a natural breath between snippets; `outroHoldFrames` extends the
 * LAST card past its audio so the viewer can dwell on it; `introHoldFrames`
 * adds a silent beat at the front of the FIRST card. Pure.
 */
export function framesFromDurations(
  cards: DevotionalCard[],
  fps: number,
  tailFrames = 0,
  outroHoldFrames = 0,
  introHoldFrames = 0,
): CardFrames[] {
  let from = 0
  const lastIndex = cards.length - 1
  return cards.map((c, i) => {
    const durationInFrames = Math.max(
      1,
      Math.round((c.durationSec ?? 0) * fps) +
        Math.round((c.holdSec ?? 0) * fps) +
        tailFrames +
        (i === 0 ? introHoldFrames : 0) +
        (i === lastIndex ? outroHoldFrames : 0),
    )
    const range = { from, durationInFrames }
    from += durationInFrames
    return range
  })
}

/** True when every card carries its own measured audio duration (Option A). */
export function hasPerCardAudio(cards: DevotionalCard[]): boolean {
  return (
    cards.length > 0 && cards.every((c) => typeof c.durationSec === "number")
  )
}

/**
 * Fallback timing when cards carry no measured audio: split the timeline
 * evenly (each card ≥ `minFrames`). Contiguous, covers the whole timeline.
 * Pure. (The real path is framesFromDurations, driven by per-card audio.)
 */
export function computeCardFrames(
  cards: DevotionalCard[],
  totalFrames: number,
  minFrames: number,
): CardFrames[] {
  if (cards.length === 0) return []
  const each = Math.max(minFrames, Math.round(totalFrames / cards.length))
  let from = 0
  return cards.map(() => {
    const range = { from, durationInFrames: each }
    from += each
    return range
  })
}
