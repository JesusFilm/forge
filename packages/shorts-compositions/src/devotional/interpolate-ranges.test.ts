import { describe, expect, it } from "vitest"

import {
  cardFadeOpacity,
  focusAt,
  focusEaseSec,
  FOCUS_EASE_MAX_SEC,
  FOCUS_EASE_MIN_SEC,
  FOCUS_SPEED_PER_SEC,
  leadLabelKnots,
} from "./DevotionalVideo"
import {
  CARD_TAIL_FRAMES,
  INTRO_HOLD_FRAMES,
  OUTRO_HOLD_FRAMES,
} from "./timing"

/**
 * Remotion's `interpolate` throws when its input range is not strictly
 * increasing, and it throws on EVERY frame — so a range built from a value the
 * schema allows aborts the whole encode, minutes in, with an error that names
 * neither the card nor the flag that produced it.
 */
describe("leadLabelKnots", () => {
  const strictlyIncreasing = (ks: ReadonlyArray<number>) =>
    ks.every((k, i) => i === 0 || k > ks[i - 1])

  it("is strictly increasing for every lead the schema and CLI allow", () => {
    // The CLI clamps to [0, 4]; the schema allows any non-negative number.
    for (let lead = 0; lead <= 8; lead += 0.05) {
      expect(strictlyIncreasing(leadLabelKnots(lead))).toBe(true)
    }
  })

  it("is strictly increasing at the values that used to throw", () => {
    // The old range was [0.15, 0.75, Math.max(1, lead - 0.35), lead + 0.35],
    // which is only increasing while lead > 0.65.
    for (const lead of [0.1, 0.5, 0.65, 0.66]) {
      expect(strictlyIncreasing(leadLabelKnots(lead))).toBe(true)
    }
  })

  it("still holds the label longer as the lead grows", () => {
    expect(leadLabelKnots(3)[2]).toBeGreaterThan(leadLabelKnots(1)[2])
  })
})

describe("timing constants duplicated in the worker", () => {
  it("still match the numbers apps/shorts-worker/scripts/render-devotional-video.mjs hard-codes", () => {
    // That script computes how long the music bed must be, and it cannot import
    // this package. It guessed these once (0.8s intro, 0.4s tail) and both were
    // wrong, so the bed was trimmed short and the video ended in silence.
    // If you change one of these, change the mirror in that script too.
    expect(CARD_TAIL_FRAMES).toBe(24)
    expect(INTRO_HOLD_FRAMES).toBe(30)
    expect(OUTRO_HOLD_FRAMES).toBe(240)
  })
})

/**
 * Hard cuts between cards. Asked for after watching the background crop move
 * under a dissolve: during a dissolve two cards are on screen at once, each
 * with its own cropping of the same footage, so the change reads as a lurch
 * instead of a cut.
 */
describe("cardFadeOpacity", () => {
  it("is fully opaque from the first frame when the fade is zero", () => {
    expect(cardFadeOpacity(0, 0)).toBe(1)
    expect(cardFadeOpacity(5, 0)).toBe(1)
  })

  it("still ramps across a real fade", () => {
    expect(cardFadeOpacity(0, 10)).toBe(0)
    expect(cardFadeOpacity(5, 10)).toBeCloseTo(0.5)
    expect(cardFadeOpacity(10, 10)).toBe(1)
    expect(cardFadeOpacity(99, 10)).toBe(1)
  })
})

describe("focusAt", () => {
  const steps = [
    { atSec: 0, x: 0.5 },
    { atSec: 2, x: 0.8 },
    { atSec: 6, x: 0.2, ease: true },
  ]

  it("cuts instantly to a step that landed on a cut in the footage", () => {
    expect(focusAt(steps, 1.99)).toBe(0.5)
    expect(focusAt(steps, 2)).toBe(0.8)
    expect(focusAt(steps, 2.01)).toBe(0.8)
  })

  it("glides into a step that could not be placed on a cut", () => {
    // Cutting the crop inside a held shot is the lurch the owner objected to.
    const dur = focusEaseSec(0.8, 0.2)
    expect(focusAt(steps, 6)).toBeCloseTo(0.8)
    const mid = focusAt(steps, 6 + dur / 2)
    expect(mid).toBeLessThan(0.8)
    expect(mid).toBeGreaterThan(0.2)
    expect(focusAt(steps, 6 + dur)).toBeCloseTo(0.2)
    expect(focusAt(steps, 20)).toBe(0.2)
  })

  it("holds the first framing before any step is due", () => {
    expect(focusAt([{ atSec: 3, x: 0.7 }], 0)).toBe(0.7)
  })
})

describe("focusEaseSec", () => {
  it("gives a longer move more time, so speed stays even", () => {
    // A fixed duration made short hops crawl and long moves fly, and the long
    // ones are what read as sharp. Distance sets the clock now, which is the
    // rule the repo's own smart-crop planner encodes as a pan-speed cap.
    const near = focusEaseSec(0.5, 0.6)
    const far = focusEaseSec(0.2, 0.8)
    expect(far).toBeGreaterThan(near)
    const speed = (a: number, b: number) => Math.abs(b - a) / focusEaseSec(a, b)
    expect(speed(0.3, 0.75)).toBeCloseTo(FOCUS_SPEED_PER_SEC, 2)
  })

  it("never snaps and never turns into a pan", () => {
    expect(focusEaseSec(0.5, 0.5001)).toBe(FOCUS_EASE_MIN_SEC)
    expect(focusEaseSec(0, 1)).toBe(FOCUS_EASE_MAX_SEC)
  })
})
