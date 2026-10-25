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
