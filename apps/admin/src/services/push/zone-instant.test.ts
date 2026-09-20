import { describe, expect, it } from "vitest"

import { PushInputError, PushUnknownTimeZoneError } from "./errors"
import { resolvePushLocalDay, resolvePushZoneInstant } from "./zone-instant"

function instant(timeZone: string, sendDate: string, localHour: number) {
  return resolvePushZoneInstant({ timeZone, sendDate, localHour }).toISOString()
}

describe("push zone instants", () => {
  it("resolves the hour in a zone that keeps one offset all year", () => {
    // Riyadh is the control: no transition can hide a bug in the other cases.
    expect(instant("Asia/Riyadh", "2026-10-01", 9)).toBe(
      "2026-10-01T06:00:00.000Z",
    )
  })

  it("resolves the hour in a zone that is on summer time", () => {
    expect(instant("Pacific/Auckland", "2026-10-01", 9)).toBe(
      "2026-09-30T20:00:00.000Z",
    )
  })

  it("rounds a skipped hour forward to the first valid instant", () => {
    // Auckland jumps 02:00 to 03:00 on 2026-09-27, so 02:00 never happens.
    expect(instant("Pacific/Auckland", "2026-09-27", 2)).toBe(
      "2026-09-26T14:00:00.000Z",
    )
  })

  it("rounds a skipped midnight forward to the first valid instant", () => {
    // Sao Paulo's old summer time started at midnight: the local day began
    // at 01:00, so a 00:00 campaign hour has no instant of its own.
    expect(instant("America/Sao_Paulo", "2018-11-04", 0)).toBe(
      "2018-11-04T03:00:00.000Z",
    )
  })

  it("rounds a skipped hour forward in the northern spring", () => {
    expect(instant("America/New_York", "2026-03-08", 2)).toBe(
      "2026-03-08T07:00:00.000Z",
    )
  })

  it("takes the first occurrence of a repeated hour", () => {
    // Auckland reads 02:00 twice on 2026-04-05; the earlier instant wins.
    expect(instant("Pacific/Auckland", "2026-04-05", 2)).toBe(
      "2026-04-04T13:00:00.000Z",
    )
  })

  it("keeps the hour beside a repeated hour unmoved", () => {
    expect(instant("Pacific/Auckland", "2026-04-05", 9)).toBe(
      "2026-04-04T21:00:00.000Z",
    )
  })

  it("resolves midnight and the last hour of the day", () => {
    expect(instant("Asia/Riyadh", "2026-10-01", 0)).toBe(
      "2026-09-30T21:00:00.000Z",
    )
    expect(instant("Asia/Riyadh", "2026-10-01", 23)).toBe(
      "2026-10-01T20:00:00.000Z",
    )
  })

  it("resolves a zone that is half an hour off the hour", () => {
    expect(instant("Asia/Kolkata", "2026-10-01", 9)).toBe(
      "2026-10-01T03:30:00.000Z",
    )
  })

  it("refuses a time zone the runtime does not know", () => {
    expect(() => instant("Middle/Earth", "2026-10-01", 9)).toThrowError(
      PushUnknownTimeZoneError,
    )
  })

  it.each([-1, 24, 9.5])("refuses the local hour %s", (localHour) => {
    expect(() => instant("Asia/Riyadh", "2026-10-01", localHour)).toThrowError(
      PushInputError,
    )
  })

  it("refuses a date that is not a real day", () => {
    expect(() => instant("Asia/Riyadh", "2026-02-30", 9)).toThrowError(
      PushInputError,
    )
  })
})

describe("push local day", () => {
  it("reads the phone's own calendar day for an instant", () => {
    expect(
      resolvePushLocalDay(
        "Pacific/Auckland",
        new Date("2026-09-30T20:00:00.000Z"),
      ),
    ).toBe("2026-10-01")
    expect(
      resolvePushLocalDay("Asia/Riyadh", new Date("2026-09-30T20:00:00.000Z")),
    ).toBe("2026-09-30")
  })

  it("refuses a time zone the runtime does not know", () => {
    expect(() => resolvePushLocalDay("Middle/Earth", new Date())).toThrowError(
      PushUnknownTimeZoneError,
    )
  })
})
