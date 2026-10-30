import { expect, it } from "vitest"
import {
  GROW_PLANS,
  GROW_PLAN_LANES,
  WATCH_GROW_COURSE,
  WATCH_GROW_PRAYER,
} from "./watch-grow-content"
it("keeps real source links and dated provenance separate from current film inventory", () => {
  expect(GROW_PLANS).toHaveLength(15)
  expect(GROW_PLAN_LANES).toContain("Women")
  for (const plan of GROW_PLANS)
    expect(plan.url).toMatch(
      new RegExp(`^https://www\\.bible\\.com/reading-plans/${plan.id}-`),
    )
  expect(WATCH_GROW_PRAYER.month).toBe("September 2026")
  expect(WATCH_GROW_PRAYER.country).toBe("Bangladesh")
  expect(WATCH_GROW_PRAYER.requests.length).toBeGreaterThanOrEqual(30)
  expect(WATCH_GROW_PRAYER.pdf).toContain("2026-09.pdf")
  expect(WATCH_GROW_COURSE.materials).toBe(
    "https://www.jesusfilm.org/beginning-with-jesus/materials/",
  )
  expect(
    JSON.stringify([WATCH_GROW_COURSE, WATCH_GROW_PRAYER, GROW_PLANS]),
  ).not.toMatch(/playbackId|speakers|sponsor|presence|participant/)
})
