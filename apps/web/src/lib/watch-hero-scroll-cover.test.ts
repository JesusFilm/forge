import { describe, expect, it } from "vitest"

import {
  isWatchHeroObscured,
  WATCH_HERO_OBSCURED_PAUSE_THRESHOLD,
  watchHeroObscuredFraction,
} from "@/lib/watch-hero-scroll-cover"

describe("watch hero scroll coverage", () => {
  it("reports nothing covered while the body sits at the hero's bottom", () => {
    expect(
      watchHeroObscuredFraction({
        heroHeight: 500,
        viewportHeight: 800,
        bodyTopFromHeroTop: 500,
      }),
    ).toBe(0)
  })

  it("reports half covered when the body has climbed halfway up", () => {
    expect(
      watchHeroObscuredFraction({
        heroHeight: 500,
        viewportHeight: 800,
        bodyTopFromHeroTop: 250,
      }),
    ).toBe(0.5)
  })

  it("clamps once the body has passed the hero's top", () => {
    expect(
      watchHeroObscuredFraction({
        heroHeight: 500,
        viewportHeight: 800,
        bodyTopFromHeroTop: -200,
      }),
    ).toBe(1)
  })

  it("measures against the viewport when the hero is taller than it", () => {
    // A hero taller than the viewport is pinned filling the viewport, so the
    // visible part is 800, not 1200 — the body only has to climb 320px to
    // cross the threshold, not 480.
    expect(
      watchHeroObscuredFraction({
        heroHeight: 1200,
        viewportHeight: 800,
        bodyTopFromHeroTop: 400,
      }),
    ).toBe(0.5)
  })

  it("treats a zero-height hero as fully covered rather than dividing by zero", () => {
    expect(
      watchHeroObscuredFraction({
        heroHeight: 0,
        viewportHeight: 800,
        bodyTopFromHeroTop: 0,
      }),
    ).toBe(1)
  })

  it("crosses at the threshold, not before it", () => {
    const atThreshold = {
      heroHeight: 500,
      viewportHeight: 800,
      bodyTopFromHeroTop: 500 * (1 - WATCH_HERO_OBSCURED_PAUSE_THRESHOLD),
    }
    expect(isWatchHeroObscured(atThreshold)).toBe(true)
    expect(
      isWatchHeroObscured({
        ...atThreshold,
        bodyTopFromHeroTop: atThreshold.bodyTopFromHeroTop + 1,
      }),
    ).toBe(false)
  })
})
