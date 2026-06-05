import { describe, expect, it } from "vitest"
import {
  nextWatchHomeCarouselIndex,
  progressPercent,
  shouldAutoAdvance,
} from "./useWatchHomeCarousel"

describe("watch home carousel helpers", () => {
  it("wraps next index around the slide list", () => {
    expect(nextWatchHomeCarouselIndex(0, 3)).toBe(1)
    expect(nextWatchHomeCarouselIndex(2, 3)).toBe(0)
    expect(nextWatchHomeCarouselIndex(0, 0)).toBe(0)
  })

  it("converts media time to a bounded percentage", () => {
    expect(progressPercent(5, 10)).toBe(50)
    expect(progressPercent(12, 10)).toBe(100)
    expect(progressPercent(-1, 10)).toBe(0)
    expect(progressPercent(1, 0)).toBe(0)
  })

  it("auto-advances only when progress crosses the threshold", () => {
    expect(shouldAutoAdvance(95, 94)).toBe(true)
    expect(shouldAutoAdvance(96, 95)).toBe(false)
    expect(shouldAutoAdvance(50, 49)).toBe(false)
  })
})
