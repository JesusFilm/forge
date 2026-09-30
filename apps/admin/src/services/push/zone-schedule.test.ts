/**
 * AE9 and KTD11 — the wave's groups and its lateness rule.
 *
 * Grouping is pure, so these tests use real IANA zones and the runtime's own
 * zone database rather than a stub.
 */
import { describe, expect, it } from "vitest"

import {
  PUSH_ZONE_LATE_LIMIT_MS,
  groupPushZonesByInstant,
  isPushZoneLate,
  resolvePushZoneGroups,
} from "./zone-schedule"

const SEND_DATE = "2026-10-01"

describe("resolvePushZoneGroups", () => {
  it("puts two zones two hours apart into two groups two hours apart", () => {
    // Asia/Dhaka is UTC+6 and Asia/Dubai is UTC+4 all year, so 09:00 local
    // falls two hours apart and the higher offset reaches its hour first.
    const groups = resolvePushZoneGroups({
      timeZones: ["Asia/Dubai", "Asia/Dhaka"],
      sendDate: SEND_DATE,
      localHour: 9,
    })

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.timeZones)).toEqual([
      ["Asia/Dhaka"],
      ["Asia/Dubai"],
    ])
    const gap = groups[1].instant.getTime() - groups[0].instant.getTime()
    expect(gap).toBe(2 * 60 * 60 * 1_000)
  })

  it("puts three zones that share one instant into one group", () => {
    const groups = resolvePushZoneGroups({
      timeZones: ["Europe/Paris", "Europe/Berlin", "Europe/Madrid"],
      sendDate: SEND_DATE,
      localHour: 9,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].timeZones).toEqual([
      "Europe/Berlin",
      "Europe/Madrid",
      "Europe/Paris",
    ])
  })

  it("orders the groups by instant, earliest first", () => {
    const groups = resolvePushZoneGroups({
      timeZones: ["America/Los_Angeles", "Pacific/Auckland", "Europe/London"],
      sendDate: SEND_DATE,
      localHour: 9,
    })

    const instants = groups.map((group) => group.instant.getTime())
    expect(instants).toEqual([...instants].sort((a, b) => a - b))
    expect(groups[0].timeZones).toEqual(["Pacific/Auckland"])
  })

  it("reads a zone's own offset on a send date that carries a change", () => {
    // New Zealand moves to daylight time on 2026-09-27, so 09:00 local on
    // 2026-10-01 is UTC+13, not UTC+12.
    const [group] = resolvePushZoneGroups({
      timeZones: ["Pacific/Auckland"],
      sendDate: SEND_DATE,
      localHour: 9,
    })

    expect(group.instant.toISOString()).toBe("2026-09-30T20:00:00.000Z")
  })

  it("splits one zone across the change when the send date is the change day", () => {
    // Europe/London leaves daylight time on 2026-10-25, so 09:00 that day is
    // UTC+0 while 09:00 the day before is UTC+1.
    const before = resolvePushZoneGroups({
      timeZones: ["Europe/London"],
      sendDate: "2026-10-24",
      localHour: 9,
    })
    const after = resolvePushZoneGroups({
      timeZones: ["Europe/London"],
      sendDate: "2026-10-25",
      localHour: 9,
    })

    expect(before[0].instant.toISOString()).toBe("2026-10-24T08:00:00.000Z")
    expect(after[0].instant.toISOString()).toBe("2026-10-25T09:00:00.000Z")
  })

  it("collapses two spellings of one zone into one group member", () => {
    // The runtime picks which spelling of an aliased zone it returns, and it
    // has changed direction between ICU builds, so the assertion is on the
    // member count rather than on the name.
    const groups = resolvePushZoneGroups({
      timeZones: ["Asia/Calcutta", "Asia/Kolkata"],
      sendDate: SEND_DATE,
      localHour: 9,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].timeZones).toHaveLength(1)
    expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(groups[0].timeZones[0])
  })

  it("drops a zone the runtime does not know instead of failing the wave", () => {
    const groups = resolvePushZoneGroups({
      timeZones: ["Pacific/Auckland", "Mars/Olympus"],
      sendDate: SEND_DATE,
      localHour: 9,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].timeZones).toEqual(["Pacific/Auckland"])
  })

  it("returns no group for an empty zone list", () => {
    expect(
      resolvePushZoneGroups({
        timeZones: [],
        sendDate: SEND_DATE,
        localHour: 9,
      }),
    ).toEqual([])
  })
})

describe("groupPushZonesByInstant", () => {
  it("groups persisted zone rows by their stored instant", () => {
    const at = (iso: string) => new Date(iso)
    const groups = groupPushZonesByInstant([
      { timeZone: "Pacific/Auckland", scheduledAt: at("2026-10-01T00:00:00Z") },
      { timeZone: "Asia/Tokyo", scheduledAt: at("2026-10-01T03:00:00Z") },
      { timeZone: "Asia/Seoul", scheduledAt: at("2026-10-01T03:00:00Z") },
    ])

    expect(groups).toEqual([
      {
        instant: at("2026-10-01T00:00:00Z"),
        timeZones: ["Pacific/Auckland"],
      },
      {
        instant: at("2026-10-01T03:00:00Z"),
        timeZones: ["Asia/Seoul", "Asia/Tokyo"],
      },
    ])
  })

  it("keeps the zone list sorted so a replay reads the same group", () => {
    const scheduledAt = new Date("2026-10-01T03:00:00Z")
    const forward = groupPushZonesByInstant([
      { timeZone: "Asia/Tokyo", scheduledAt },
      { timeZone: "Asia/Seoul", scheduledAt },
    ])
    const reverse = groupPushZonesByInstant([
      { timeZone: "Asia/Seoul", scheduledAt },
      { timeZone: "Asia/Tokyo", scheduledAt },
    ])

    expect(forward).toEqual(reverse)
  })
})

describe("isPushZoneLate", () => {
  const instant = new Date("2026-10-01T00:00:00Z")

  it("calls a group three hours and one minute past late", () => {
    const now = new Date(instant.getTime() + PUSH_ZONE_LATE_LIMIT_MS + 60_000)

    expect(isPushZoneLate(instant, now)).toBe(true)
  })

  it("calls a group two hours past on time, so it still sends", () => {
    const now = new Date(instant.getTime() + 2 * 60 * 60 * 1_000)

    expect(isPushZoneLate(instant, now)).toBe(false)
  })

  it("calls a group exactly at the limit on time", () => {
    const now = new Date(instant.getTime() + PUSH_ZONE_LATE_LIMIT_MS)

    expect(isPushZoneLate(instant, now)).toBe(false)
  })

  it("never calls a future group late", () => {
    const now = new Date(instant.getTime() - 60_000)

    expect(isPushZoneLate(instant, now)).toBe(false)
  })

  it("holds the limit at three hours", () => {
    expect(PUSH_ZONE_LATE_LIMIT_MS).toBe(3 * 60 * 60 * 1_000)
  })
})
