import { describe, expect, it } from "vitest"

import {
  PLANNED_END_ISO,
  PLANNED_PHASES,
  PLANNED_START_ISO,
  PLANNED_TIMELINE_ROWS,
  PLANNED_TRACK_BARS,
  PLANNED_WEEK_COUNT,
  PLANNED_WEEKS,
  formatRoadmapCalendarRange,
} from "./plannedRoadmap"

const HISTORICAL_PHASE_IDS = [
  "phase-0",
  "phase-1",
  "phase-2",
  "phase-3",
  "phase-4",
  "phase-5",
  "phase-6",
]

const HISTORICAL_TRACK_BAR_IDS = [
  "actual-foundation-track",
  "actual-player-track",
  "actual-experiences-track",
  "actual-search-track",
  "actual-homepage-track",
  "actual-stability-track",
  "actual-shutdown-track",
  "agentic-track",
  "agentic-deployment-track",
  "agentic-deployment-track-2",
  "agentic-deployment-track-3",
  "agentic-deployment-track-4",
  "agentic-deployment-track-5",
  "mobile-track",
  "mobile-single-player-track",
  "mobile-experiences-track",
  "mobile-search-track",
  "mobile-homepage-track",
  "mobile-stability-track",
]

describe("planned roadmap", () => {
  it("covers April 28 through December 31 in 36 weekly columns", () => {
    expect(PLANNED_START_ISO).toBe("2026-04-28")
    expect(PLANNED_END_ISO).toBe("2026-12-31")
    expect(PLANNED_WEEK_COUNT).toBe(36)
    expect(PLANNED_WEEKS).toHaveLength(36)
    expect(PLANNED_WEEKS[0]).toMatchObject({
      isoDate: "2026-04-28",
      endIsoDate: "2026-05-04",
      dateLabel: "Apr 28-May 4",
    })
    expect(PLANNED_WEEKS.at(-1)).toMatchObject({
      isoDate: "2026-12-29",
      endIsoDate: "2026-12-31",
      dateLabel: "Dec 29-31",
    })
    expect(formatRoadmapCalendarRange("2026-04-28", "2026-05-11")).toBe(
      "Apr 28 - May 11",
    )
  })

  it("preserves every April-August phase and track bar", () => {
    expect(PLANNED_PHASES.map(({ id }) => id)).toEqual(HISTORICAL_PHASE_IDS)
    expect(
      PLANNED_TRACK_BARS.filter(({ track }) => track !== "future-work").map(
        ({ id }) => id,
      ),
    ).toEqual(HISTORICAL_TRACK_BAR_IDS)
  })

  it("adds each year-end priority as its own four-week block", () => {
    const futureWork = PLANNED_TRACK_BARS.filter(
      ({ track }) => track === "future-work",
    )

    expect(futureWork).toHaveLength(21)
    expect(
      futureWork.reduce<Record<number, number>>((counts, { startWeek }) => {
        counts[startWeek] = (counts[startWeek] ?? 0) + 1
        return counts
      }, {}),
    ).toEqual({ 15: 5, 19: 5, 23: 4, 27: 4, 31: 3 })
    expect(futureWork.every(({ spanWeeks }) => spanWeeks === 4)).toBe(true)

    for (const startWeek of [15, 19, 23, 27, 31]) {
      const cycle = futureWork.filter((bar) => bar.startWeek === startWeek)
      expect(new Set(cycle.map(({ lane }) => lane)).size).toBe(cycle.length)
    }

    expect(futureWork.map(({ title }) => title)).toEqual([
      "Caleb: Explore China streaming",
      "Urim + Up: Define Mobile + TV MVP",
      "Nisal: Improve search quality",
      "Jaco + Jian Wei: Decompose components",
      "Jaco + Jian Wei: Present to Miheret",
      "Tatai + Lyuba: Advance video agents",
      "Tatai: Run experience generation",
      "Build service-improvement loops",
      "Caleb: Expand language support",
      "Siyang + ZY: Ship NextSteps",
      "Vlad: Translate Core content",
      "Vlad: Translate Bible quotations",
      "Vlad: Add accounts + notifications",
      "Vlad: Collect mission stories",
      "Vlad: Clarify next-step actions",
      "Vlad: Make search shareable",
      "Vlad: Create verse video pages",
      "Vlad: Generate video FAQs",
      "Vlad: Operate SEO agent",
      "Vlad: Operate support agent",
      "Vlad: Operate translation agent",
    ])
  })

  it("uses one delivery row for completed releases and future priorities", () => {
    expect(PLANNED_TIMELINE_ROWS.map(({ id }) => id)).toEqual([
      "delivery-planned",
      "experimentation",
    ])
    expect(PLANNED_TIMELINE_ROWS[0]?.trackIds).toEqual([
      "foundation",
      "surface",
      "search",
      "future-work",
    ])
    expect(PLANNED_TIMELINE_ROWS[0]?.stackByLane).toBe(true)
    expect(PLANNED_PHASES.every(({ completed }) => completed)).toBe(true)
  })

  it("keeps every timeline item unique and within the calendar", () => {
    for (const items of [PLANNED_PHASES, PLANNED_TRACK_BARS]) {
      expect(new Set(items.map(({ id }) => id)).size).toBe(items.length)

      for (const { startWeek, spanWeeks } of items) {
        expect(startWeek).toBeGreaterThanOrEqual(0)
        expect(startWeek + spanWeeks).toBeLessThanOrEqual(PLANNED_WEEK_COUNT)
      }
    }
  })
})
