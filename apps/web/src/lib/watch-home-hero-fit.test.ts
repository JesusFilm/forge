import { describe, expect, it } from "vitest"

import { readFileSync } from "node:fs"

import {
  fitWatchHomeHeroHeight,
  WATCH_HOME_HERO_ASPECT_RATIO,
  WATCH_HOME_HERO_MIN_HEIGHT_RATIO,
  WATCH_HOME_HERO_MOBILE_VIEWPORT_RATIO,
  WATCH_HOME_HERO_RESERVE_BELOW_MOBILE_PX,
  WATCH_HOME_HERO_RESERVE_BELOW_PX,
  WATCH_MUTED_INTRO_HEIGHT_CLASS,
} from "@/lib/watch-home-hero-fit"

describe("watch home hero fit", () => {
  it("leaves exactly enough room for the content below it", () => {
    // The reported case: 2001x1202 with a 425px categories rail. The intro was
    // 864px tall, so the rail ran 87px past the fold.
    const fitted = fitWatchHomeHeroHeight({
      viewportHeight: 1202,
      aspectHeight: Math.min(1202, 2001 * 0.5625),
      reservedBelow: 425,
    })
    expect(fitted).toBe(777)
    expect(fitted + 425).toBeLessThanOrEqual(1202)
  })

  it("never grows the intro past its own aspect height", () => {
    // A tall narrow window leaves plenty of room below; the 16:9 height wins
    // and nothing is reserved away.
    expect(
      fitWatchHomeHeroHeight({
        viewportHeight: 1400,
        aspectHeight: 600,
        reservedBelow: 400,
      }),
    ).toBe(600)
  })

  it("floors the intro rather than collapsing it when nothing fits", () => {
    // Rail taller than the space available: the rail cannot fit, and shrinking
    // the intro to 0 would not help.
    const viewportHeight = 700
    expect(
      fitWatchHomeHeroHeight({
        viewportHeight,
        aspectHeight: 500,
        reservedBelow: 900,
      }),
    ).toBe(Math.round(viewportHeight * WATCH_HOME_HERO_MIN_HEIGHT_RATIO))
  })

  it("keeps the floor under the aspect height so a tiny hero is not inflated", () => {
    // Aspect height below the floor: the floor must not push it back up.
    expect(
      fitWatchHomeHeroHeight({
        viewportHeight: 1000,
        aspectHeight: 200,
        reservedBelow: 900,
      }),
    ).toBe(200)
  })

  it("floors rather than rounds, so a fractional rail height cannot overflow", () => {
    // Rounding 776.6 up to 777 puts the rail's bottom edge one pixel past the
    // fold — the exact off-by-one seen in the browser.
    const viewportHeight = 1202
    const reservedBelow = 425.4
    const fitted = fitWatchHomeHeroHeight({
      viewportHeight,
      aspectHeight: 1125,
      reservedBelow,
    })
    expect(fitted).toBe(776)
    expect(fitted + reservedBelow).toBeLessThanOrEqual(viewportHeight)
  })

  it("reserves more for a taller rail", () => {
    const shortRail = fitWatchHomeHeroHeight({
      viewportHeight: 1000,
      aspectHeight: 900,
      reservedBelow: 400,
    })
    const tallRail = fitWatchHomeHeroHeight({
      viewportHeight: 1000,
      aspectHeight: 900,
      reservedBelow: 500,
    })
    expect(shortRail).toBe(600)
    expect(tallRail).toBe(500)
  })
})

describe("watch home hero ratios", () => {
  it("matches the Tailwind literals the pre-hydration classes use", () => {
    // Tailwind cannot interpolate, so the height classes hand-type these two
    // numbers as `56.25vw` and `66svh`. Nothing but this test connects the
    // measured path to the CSS one.
    const carousel = readFileSync(
      "src/components/home/WatchHomeTvCarousel.tsx",
      "utf8",
    )
    expect(`${WATCH_HOME_HERO_ASPECT_RATIO * 100}vw`).toBe("56.25vw")
    expect(carousel).toContain("56.25vw")
    expect(`${WATCH_HOME_HERO_MOBILE_VIEWPORT_RATIO * 100}svh`).toBe("66svh")
    expect(carousel).toContain("h-[66svh]")
    // The floor shares the same hazard.
    expect(`${WATCH_HOME_HERO_MIN_HEIGHT_RATIO * 100}svh`).toBe("34svh")
    expect(WATCH_MUTED_INTRO_HEIGHT_CLASS).toContain("34svh")
    expect(WATCH_MUTED_INTRO_HEIGHT_CLASS).toContain("56.25vw")
    expect(WATCH_MUTED_INTRO_HEIGHT_CLASS).toContain(
      `${WATCH_HOME_HERO_RESERVE_BELOW_MOBILE_PX}px`,
    )
    expect(WATCH_MUTED_INTRO_HEIGHT_CLASS).toContain(
      `${WATCH_HOME_HERO_RESERVE_BELOW_PX}px`,
    )
  })
})
