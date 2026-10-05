import { describe, expect, it } from "vitest"

import { ctaCutSec, shiftForCuts, teaserPauseCuts } from "./devotional-render"

describe("ctaCutSec", () => {
  // Martha's take: "...answers it." then the beat, a breath, "Let's watch."
  // The "Let's" word time is 18.43 but the voice starts at ~18.14.
  const silences = [
    { startSec: 16.97, endSec: 17.83 },
    { startSec: 17.835, endSec: 18.135 },
  ]
  it("cuts inside the beat before the line, not at the late word time", () => {
    const cut = ctaCutSec(silences, 18.43)
    expect(cut).toBeGreaterThan(16.97)
    expect(cut).toBeLessThan(17.2)
  })
  it("backs off well before the word time when the take has no pause", () => {
    expect(ctaCutSec([], 18.43)).toBeCloseTo(18.08, 2)
  })
})

describe("teaserPauseCuts", () => {
  it("keeps a short beat at line breaks and almost none at commas", () => {
    const cuts = teaserPauseCuts([
      { startSec: 3.0, endSec: 3.8 }, // between lines
      { startSec: 5.0, endSec: 5.25 }, // a comma
      { startSec: 7.0, endSec: 7.1 }, // already tight
    ])
    expect(cuts).toHaveLength(2)
    expect(cuts[0].drop).toBeCloseTo(0.8 - 0.22, 5)
    expect(cuts[1].drop).toBeCloseTo(0.25 - 0.08, 5)
  })
  it("moves the words after each cut earlier by what was dropped", () => {
    const words = [
      { word: "a", startSec: 1, endSec: 2 },
      { word: "b", startSec: 4, endSec: 5 },
    ]
    const out = shiftForCuts(words, [{ at: 3.4, drop: 0.5 }])
    expect(out[0].startSec).toBe(1)
    expect(out[1].startSec).toBeCloseTo(3.5, 5)
  })
})
