import { describe, expect, it } from "vitest"
import {
  calendarDays,
  resolveCalendarTime,
  calendarZoneSchema,
  calendarPlannerInputSchema,
  parseCalendarSuggestions,
} from "./calendar"

describe("calendar civil time", () => {
  it("accepts only admitted weekly themes with exact pack/source bindings", () => {
    const context = calendarPlannerInputSchema.parse({
      calendarId: "calendar",
      version: 1,
      language: "english",
      slots: [],
      weeks: [{ startDate: "2026-09-28", packRevisionIds: ["guidance"] }],
      packs: [
        {
          revisionId: "guidance",
          document: { title: "Hope", guidance: "Weekly hope", sources: [] },
        },
      ],
    })
    const week = {
      startDate: "2026-09-28",
      theme: "Hope together",
      packRevisionId: "guidance",
      sourceIndices: [],
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
  it("accepts default packs plus distinct slot assignments without dropping pack context", () => {
    const defaults = Array.from({ length: 16 }, (_, i) => `default-${i}`)
    const input = {
      calendarId: "calendar",
      version: 1,
      language: "english",
      slots: [
        {
          date: "2026-09-22",
          version: 1,
          packRevisionIds: defaults,
          weeklyTheme: "",
        },
        {
          date: "2026-09-23",
          version: 1,
          packRevisionIds: ["assigned"],
          weeklyTheme: "",
        },
      ],
      packs: [...defaults, "assigned"].map((revisionId) => ({
        revisionId,
        document: {
          title: revisionId,
          guidance: "Title guidance",
          sources: [],
        },
      })),
    }
    expect(calendarPlannerInputSchema.parse(input).packs).toHaveLength(17)
    expect(
      calendarPlannerInputSchema.safeParse({
        ...input,
        packs: input.packs.map((pack) => ({
          ...pack,
          document: { ...pack.document, guidance: "x".repeat(16000) },
        })),
      }).success,
    ).toBe(false)
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
