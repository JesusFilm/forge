import { expect, it } from "vitest"
import { timelineScale } from "./timeline-scale"

it("keeps blocks at their zoomed size while the grid fills a wider viewport", () => {
  const narrow = timelineScale(300, 30, 1, 800)
  const wide = timelineScale(300, 30, 1, 1800)
  expect(narrow.width).toBe(800)
  expect(wide.width).toBe(1800)
  expect(wide.px).toBe(narrow.px)
  expect(150 * wide.px).toBe(350)
})

it("shrinks blocks on zoom-out without shrinking the grid or stopping the ruler", () => {
  const scale = timelineScale(300, 30, 0.3, 1200)
  expect(scale.width).toBe(1200)
  expect(150 * scale.px).toBe(105)
  // A tick 1120px across the empty area remains on the same time scale.
  expect(1120 / scale.px / 30).toBeCloseTo(53.3333)
})

it("expands the scroll canvas on zoom-in and uses that same scale for seeking", () => {
  const scale = timelineScale(300, 30, 4, 1200)
  expect(scale.width).toBe(2800)
  expect(1400 / scale.px).toBe(150)
})
