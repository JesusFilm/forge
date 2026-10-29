import { describe, expect, it } from "vitest"

import { computeNextRunAt, formatScheduleSummary } from "./schedule-summary"

describe("formatScheduleSummary", () => {
  it("formats supported schedule shapes for operator display", () => {
    expect(
      formatScheduleSummary({ kind: "every_minute", timezone: "UTC" }),
    ).toBe("Every minute")
    expect(
      formatScheduleSummary({ kind: "hourly", minute: 5, timezone: "UTC" }),
    ).toBe("Hourly at :05")
    expect(
      formatScheduleSummary({
        kind: "daily",
        hour: 9,
        minute: 0,
        timezone: "UTC",
      }),
    ).toBe("Daily at 9:00 AM")
    expect(
      formatScheduleSummary({
        kind: "weekly",
        weekday: "mon",
        hour: 14,
        minute: 30,
        timezone: "UTC",
      }),
    ).toBe("Weekly on Monday at 2:30 PM")
  })

  it("computes next runs in the schedule timezone", () => {
    expect(
      computeNextRunAt(
        { kind: "daily", hour: 9, minute: 0, timezone: "America/Halifax" },
        new Date("2026-04-12T10:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-04-12T12:00:00.000Z")

    expect(
      computeNextRunAt(
        {
          kind: "weekly",
          weekday: "mon",
          hour: 9,
          minute: 30,
          timezone: "America/Halifax",
        },
        new Date("2026-04-12T10:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-04-13T12:30:00.000Z")
  })
})

describe("IANA schedule transitions", () => {
  it.each([
    ["Europe/Berlin", "2026-03-29T00:45:00Z", "2026-03-29T01:30:00.000Z"],
    ["Australia/Sydney", "2026-10-03T15:45:00Z", "2026-10-03T16:30:00.000Z"],
    ["America/New_York", "2026-03-08T06:45:00Z", "2026-03-08T07:30:00.000Z"],
  ])("skips a nonexistent hourly :30 in %s", (timezone, from, expected) => {
    const next = computeNextRunAt(
      { kind: "hourly", minute: 30, timezone },
      new Date(from),
    )
    expect(next.toISOString()).toBe(expected)
    expect(next.getTime()).toBeGreaterThan(new Date(from).getTime())
  })

  it.each([
    ["Europe/Berlin", "2026-03-29T00:45:00Z", "2026-03-30T00:30:00.000Z"],
    ["Australia/Sydney", "2026-10-03T15:45:00Z", "2026-10-04T15:30:00.000Z"],
    ["Europe/Berlin", "2026-03-28T23:00:00Z", "2026-03-30T00:30:00.000Z"],
    ["Australia/Sydney", "2026-10-03T14:00:00Z", "2026-10-04T15:30:00.000Z"],
  ])("skips a nonexistent daily 02:30 in %s", (timezone, from, expected) => {
    expect(
      computeNextRunAt(
        { kind: "daily", hour: 2, minute: 30, timezone },
        new Date(from),
      ).toISOString(),
    ).toBe(expected)
  })

  it.each([
    ["Europe/Berlin", "2026-03-29T00:45:00Z", "2026-04-05T00:30:00.000Z"],
    ["Australia/Sydney", "2026-10-03T15:45:00Z", "2026-10-10T15:30:00.000Z"],
    ["Europe/Berlin", "2026-03-28T23:00:00Z", "2026-04-05T00:30:00.000Z"],
    ["Australia/Sydney", "2026-10-03T14:00:00Z", "2026-10-10T15:30:00.000Z"],
  ])(
    "skips a nonexistent weekly Sunday 02:30 in %s",
    (timezone, from, expected) => {
      expect(
        computeNextRunAt(
          { kind: "weekly", weekday: "sun", hour: 2, minute: 30, timezone },
          new Date(from),
        ).toISOString(),
      ).toBe(expected)
    },
  )

  it("handles Lord Howe's half-hour spring gap", () => {
    expect(
      computeNextRunAt(
        { kind: "hourly", minute: 15, timezone: "Australia/Lord_Howe" },
        new Date("2026-10-03T15:20:00Z"),
      ).toISOString(),
    ).toBe("2026-10-03T16:15:00.000Z")
  })

  it("skips Apia's missing calendar day", () => {
    expect(
      computeNextRunAt(
        { kind: "daily", hour: 9, minute: 0, timezone: "Pacific/Apia" },
        new Date("2011-12-29T21:00:00Z"),
      ).toISOString(),
    ).toBe("2011-12-30T19:00:00.000Z")
  })

  it.each(["hourly", "daily", "weekly"] as const)(
    "uses the next future %s occurrence inside a fall fold",
    (kind) => {
      expect(
        computeNextRunAt(
          {
            kind,
            hour: 2,
            minute: 30,
            weekday: "sun",
            timezone: "Europe/Berlin",
          },
          new Date("2026-10-25T00:45:00Z"),
        ).toISOString(),
      ).toBe("2026-10-25T01:30:00.000Z")
    },
  )

  it.each(["hourly", "daily", "weekly"] as const)(
    "uses the first %s occurrence before a fall fold",
    (kind) => {
      expect(
        computeNextRunAt(
          {
            kind,
            hour: 2,
            minute: 30,
            weekday: "sun",
            timezone: "Europe/Berlin",
          },
          new Date("2026-10-24T23:45:00Z"),
        ).toISOString(),
      ).toBe("2026-10-25T00:30:00.000Z")
    },
  )

  it("resolves the second hourly occurrence in Lord Howe's half-hour fold", () => {
    expect(
      computeNextRunAt(
        { kind: "hourly", minute: 45, timezone: "Australia/Lord_Howe" },
        new Date("2026-04-04T14:50:00Z"),
      ).toISOString(),
    ).toBe("2026-04-04T15:15:00.000Z")
  })

  it("keeps every-minute cadence strictly future through a gap", () => {
    expect(
      computeNextRunAt(
        { kind: "every_minute", timezone: "Europe/Berlin" },
        new Date("2026-03-29T00:59:59.999Z"),
      ).toISOString(),
    ).toBe("2026-03-29T01:00:00.000Z")
  })
})
