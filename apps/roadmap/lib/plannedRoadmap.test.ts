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

  it("adds five sequential four-week year-end priorities", () => {
    const futureWork = PLANNED_TRACK_BARS.filter(
      ({ track }) => track === "future-work",
    )

    expect(futureWork).toHaveLength(5)
    expect(
      futureWork.map(({ startWeek, spanWeeks }) => ({ startWeek, spanWeeks })),
    ).toEqual([
      { startWeek: 15, spanWeeks: 4 },
      { startWeek: 19, spanWeeks: 4 },
      { startWeek: 23, spanWeeks: 4 },
      { startWeek: 27, spanWeeks: 4 },
      { startWeek: 31, spanWeeks: 4 },
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
