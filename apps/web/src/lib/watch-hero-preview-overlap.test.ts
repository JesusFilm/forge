import { describe, expect, it } from "vitest"

import {
  HERO_PREVIEW_BODY_OVERLAP_EXTRA_PX,
  HERO_PREVIEW_BODY_OVERLAP_MAX_PX,
  HERO_PREVIEW_BODY_OVERLAP_MIN_PX,
  HERO_PREVIEW_BODY_OVERLAP_VIEWPORT_PERCENT,
  WATCH_HERO_BODY_OVERLAP_CSS,
} from "@/lib/watch-hero-preview-overlap"

describe("watch muted-preview overlap ceiling", () => {
  it("keeps the ceiling above the floor so the clamp cannot invert", () => {
    expect(HERO_PREVIEW_BODY_OVERLAP_MAX_PX).toBeGreaterThan(
      HERO_PREVIEW_BODY_OVERLAP_MIN_PX,
    )
    expect(HERO_PREVIEW_BODY_OVERLAP_EXTRA_PX).toBeGreaterThanOrEqual(0)
  })

  it("states the viewport share as a percent, since HeroPlayer divides by 100", () => {
    expect(HERO_PREVIEW_BODY_OVERLAP_VIEWPORT_PERCENT).toBe(24)
    // The percent has to land between the floor and ceiling for a normal
    // desktop window, or the clamp would always pick one end.
    const atTypicalViewport =
      (900 * HERO_PREVIEW_BODY_OVERLAP_VIEWPORT_PERCENT) / 100
    expect(atTypicalViewport).toBeGreaterThan(HERO_PREVIEW_BODY_OVERLAP_MIN_PX)
    expect(atTypicalViewport).toBeLessThan(HERO_PREVIEW_BODY_OVERLAP_MAX_PX)
  })

  it("composes the CSS length from the same numbers HeroPlayer measures with", () => {
    expect(WATCH_HERO_BODY_OVERLAP_CSS).toBe(
      `calc(min(${HERO_PREVIEW_BODY_OVERLAP_MAX_PX}px, max(${HERO_PREVIEW_BODY_OVERLAP_MIN_PX}px, ${HERO_PREVIEW_BODY_OVERLAP_VIEWPORT_PERCENT}svh)) + ${HERO_PREVIEW_BODY_OVERLAP_EXTRA_PX}px)`,
    )
  })

  it("keeps whitespace around the calc operator", () => {
    // `calc(A+B)` is invalid CSS, and an invalid length does not error — it
    // collapses whatever it sizes to 0. Caught in a browser, not by types.
    expect(WATCH_HERO_BODY_OVERLAP_CSS).toContain(" + ")
    expect(WATCH_HERO_BODY_OVERLAP_CSS).not.toMatch(/\S[+-]\S/)
  })
})
