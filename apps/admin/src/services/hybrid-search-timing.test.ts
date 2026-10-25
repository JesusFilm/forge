import { describe, expect, it } from "vitest"

import { activeTimingIntervalsMs } from "./hybrid-search-timing"

describe("activeTimingIntervalsMs", () => {
  it("merges overlapping intervals and excludes idle gaps", () => {
    expect(
      activeTimingIntervalsMs([
        { startedAt: 20, endedAt: 35 },
        { startedAt: 0, endedAt: 10 },
        { startedAt: 5, endedAt: 15 },
        { startedAt: 28, endedAt: 40 },
      ]),
    ).toBe(35)
  })

  it("returns 0 for no active retrieval intervals", () => {
    expect(activeTimingIntervalsMs([])).toBe(0)
  })
})
