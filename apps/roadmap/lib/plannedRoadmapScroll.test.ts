import { describe, expect, it } from "vitest"

import { getTimelineScrollLeft } from "./plannedRoadmapScroll"

describe("getTimelineScrollLeft", () => {
  it("centers the marker in the visible timeline area", () => {
    expect(
      getTimelineScrollLeft({
        markerPct: 50,
        viewportWidth: 1_000,
        scrollWidth: 4_000,
        stickyWidth: 200,
      }),
    ).toBe(1_500)
  })

  it("clamps markers near the start to the first week", () => {
    expect(
      getTimelineScrollLeft({
        markerPct: 0,
        viewportWidth: 1_000,
        scrollWidth: 4_000,
        stickyWidth: 200,
      }),
    ).toBe(0)
  })

  it("clamps markers near the end to the final week", () => {
    expect(
      getTimelineScrollLeft({
        markerPct: 100,
        viewportWidth: 1_000,
        scrollWidth: 4_000,
        stickyWidth: 200,
      }),
    ).toBe(3_000)
  })

  it("handles a viewport narrower than the sticky label", () => {
    expect(
      getTimelineScrollLeft({
        markerPct: 50,
        viewportWidth: 160,
        scrollWidth: 4_000,
        stickyWidth: 200,
      }),
    ).toBe(1_900)
  })
})
