import { describe, expect, it } from "vitest"

import { computeNextRunAt } from "./schedule"

describe("computeNextRunAt", () => {
  it("schedules every-minute automations at the next minute boundary", () => {
    expect(
      computeNextRunAt(
        { kind: "every_minute", timezone: "UTC" },
        new Date("2026-04-12T09:00:30.000Z"),
      ).toISOString(),
    ).toBe("2026-04-12T09:01:00.000Z")
  })

  it("schedules hourly automations at the configured minute", () => {
    expect(
      computeNextRunAt(
        { kind: "hourly", minute: 15, timezone: "UTC" },
        new Date("2026-04-12T09:10:00.000Z"),
      ).toISOString(),
    ).toBe("2026-04-12T09:15:00.000Z")

    expect(
      computeNextRunAt(
        { kind: "hourly", minute: 15, timezone: "UTC" },
        new Date("2026-04-12T09:20:00.000Z"),
      ).toISOString(),
    ).toBe("2026-04-12T10:15:00.000Z")
  })

  it("schedules daily and weekly automations after the current instant", () => {
    expect(
      computeNextRunAt(
        { kind: "daily", hour: 9, minute: 0, timezone: "UTC" },
        new Date("2026-04-12T10:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-04-13T09:00:00.000Z")

    expect(
      computeNextRunAt(
        {
          kind: "weekly",
          weekday: "mon",
          hour: 9,
          minute: 30,
          timezone: "UTC",
        },
        new Date("2026-04-12T10:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-04-13T09:30:00.000Z")
  })

  it("interprets daily and weekly hours in the schedule timezone", () => {
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
