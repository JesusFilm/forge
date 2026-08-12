import { describe, expect, it } from "vitest"

import { AUGUST_2026_CALENDAR, calendarEntryFor } from "./devotional-calendar"

describe("calendarEntryFor", () => {
  it("returns the pinned chapter + sequence for a planned date", () => {
    expect(calendarEntryFor("2026-08-11")).toEqual({
      chapterIndex: 21,
      sequence: 103,
    })
  })

  it("returns null for an unplanned date", () => {
    expect(calendarEntryFor("2026-08-12")).toBeNull()
    expect(calendarEntryFor("2026-09-04")).toBeNull()
  })

  it("every calendar sequence is unique (no two dates collide on cache key)", () => {
    const sequences = Object.values(AUGUST_2026_CALENDAR).map((e) => e.sequence)
    expect(new Set(sequences).size).toBe(sequences.length)
  })
})
