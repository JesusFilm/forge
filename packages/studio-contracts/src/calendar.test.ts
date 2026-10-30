import { describe, expect, it } from "vitest"
import {
  calendarDays,
  resolveCalendarTime,
  calendarZoneSchema,
  calendarPlannerInputSchema,
  parseCalendarSuggestions,
} from "./calendar"

describe("calendar civil time", () => {
  it("accepts only admitted weekly themes with exact week bindings", () => {
    const context = calendarPlannerInputSchema.parse({
      calendarId: "calendar",
      version: 1,
      language: "english",
      slots: [],
      weeks: [{ startDate: "2026-09-28" }],
    })
    const week = {
      startDate: "2026-09-28",
      theme: "Hope together",
    }
    expect(
      parseCalendarSuggestions({ items: [], weeks: [week] }, context).weeks,
    ).toEqual([week])
    for (const invalid of [
      { ...week, startDate: "2026-09-21" },
      { ...week, sourceIndices: [0] },
      { ...week, script: "Not permitted" },
    ])
      expect(() =>
        parseCalendarSuggestions({ items: [], weeks: [invalid] }, context),
      ).toThrow()
  })
  it("binds title suggestions to admitted dates and revisions without sources", () => {
    const context = calendarPlannerInputSchema.parse({
      calendarId: "calendar",
      version: 1,
      language: "english",
      slots: [{ date: "2026-09-22", version: 2, weeklyTheme: "Hope" }],
    })
    const item = {
      date: "2026-09-22",
      expectedVersion: 2,
      title: "Hope today",
      theme: "Hope",
    }
    expect(parseCalendarSuggestions({ items: [item] }, context).items).toEqual([
      item,
    ])
    for (const invalid of [
      { ...item, date: "2026-09-23" },
      { ...item, expectedVersion: 1 },
    ])
      expect(() =>
        parseCalendarSuggestions({ items: [invalid] }, context),
      ).toThrow()
  })
  it("rejects fixed-offset zones but accepts UTC and supported IANA names and aliases", () => {
    for (const zone of ["+02:00", "-03:30", "+0200", "-0330"])
      expect(calendarZoneSchema.safeParse(zone).success).toBe(false)
    for (const zone of ["UTC", "Pacific/Auckland", "NZ", "US/Eastern"])
      expect(calendarZoneSchema.safeParse(zone).success).toBe(true)
  })
  it("shows two complete fortnights across month boundaries in the chosen timezone", () => {
    const days = calendarDays(
      "Pacific/Auckland",
      new Date("2026-09-20T12:30:00Z"),
    )
    expect(days).toHaveLength(28)
    expect([days[0], days[13], days[14], days[27]]).toEqual([
      "2026-09-21",
      "2026-10-04",
      "2026-10-05",
      "2026-10-18",
    ])
  })
  it("rejects spring gaps and requires a choice for fall folds without UTC fallback", () => {
    expect(() =>
      resolveCalendarTime("2026-09-27", "02:30", "Pacific/Auckland"),
    ).toThrow("NONEXISTENT_TIME")
    expect(() =>
      resolveCalendarTime("2026-04-05", "02:30", "Pacific/Auckland"),
    ).toThrow("AMBIGUOUS_TIME")
    expect(
      resolveCalendarTime("2026-04-05", "02:30", "Pacific/Auckland", "earlier"),
    ).toBe("2026-04-04T13:30:00.000Z")
    expect(
      resolveCalendarTime("2026-04-05", "02:30", "Pacific/Auckland", "later"),
    ).toBe("2026-04-04T14:30:00.000Z")
    expect(() =>
      resolveCalendarTime("2026-01-01", "09:00", "Not/AZone"),
    ).toThrow()
  })
})
