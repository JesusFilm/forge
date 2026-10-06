import { createImpressionTracker, visibleFraction } from "./visibility"

it("clips horizontal and vertical visibility independently", () => {
  expect(
    visibleFraction(
      { x: -50, y: -50, width: 100, height: 100 },
      { x: 0, y: 0, width: 100, height: 100 },
    ),
  ).toBe(0.25)
  expect(
    visibleFraction(
      { x: -50, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 100, height: 100 },
    ),
  ).toBe(0.5)
})
it("requires a continuous second above 50%, and emits once per delivery", () => {
  const tracker = createImpressionTracker()
  expect(tracker.observe("card", 0.5, true, 0)).toBe(false)
  expect(tracker.observe("card", 0.5, true, 999)).toBe(false)
  expect(tracker.observe("card", 0.5, true, 1000)).toBe(true)
  expect(tracker.observe("card", 1, true, 2000)).toBe(false)
})
it("interrupts qualification when offscreen, backgrounded or obscured", () => {
  const tracker = createImpressionTracker()
  tracker.observe("card", 1, true, 0)
  tracker.observe("card", 0.49, true, 900)
  expect(tracker.observe("card", 1, true, 1000)).toBe(false)
  tracker.observe("card", 1, false, 1900)
  expect(tracker.observe("card", 1, true, 2000)).toBe(false)
  tracker.interrupt()
  expect(tracker.observe("card", 1, true, 3000)).toBe(false)
  expect(tracker.observe("card", 1, true, 4000)).toBe(true)
})
