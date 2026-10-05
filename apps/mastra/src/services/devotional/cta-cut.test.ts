import { describe, expect, it } from "vitest"

import { ctaCutSec } from "./devotional-render"

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
