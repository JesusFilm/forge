import {
  LAPSE_REMINDER_COPY,
  LAPSE_REMINDER_DAY_OFFSETS,
  LAPSE_REMINDER_IDENTIFIERS,
  LAPSE_REMINDER_WINDOW_END_HOUR,
  LAPSE_REMINDER_WINDOW_START_HOUR,
} from "../constants"
import {
  computeLapseReminderTargets,
  snapIntoReminderWindow,
} from "../schedule"

const AUCKLAND = "Pacific/Auckland"
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Local calendar fields — the only frame KTD3 computes in and R6 snaps on. */
function fields(date: Date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  }
}

/** A local instant, month written the way a person writes it. */
function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  ms = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, second, ms).getTime()
}

function setTimeZone(zone: string | undefined): void {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
}

/**
 * A zone case proves nothing on a runtime that ignores a mid-process change,
 * so the suite asks before it asserts. Node 24 honours it.
 */
function timeZoneChangeWorks(): boolean {
  const original = process.env.TZ
  try {
    setTimeZone(AUCKLAND)
    // New Zealand standard time is UTC+12, which reads as -720 minutes.
    return new Date(2026, 8, 21, 20, 30).getTimezoneOffset() === -720
  } finally {
    setTimeZone(original)
  }
}

describe("the reminder constants", () => {
  // R6 names these two hours. A silent widening is a product change, not a
  // refactor, so it goes red here first.
  it("keeps the 09:00-21:00 window R6 fixes", () => {
    expect(LAPSE_REMINDER_WINDOW_START_HOUR).toBe(9)
    expect(LAPSE_REMINDER_WINDOW_END_HOUR).toBe(21)
  })

  it("keeps the one-day and seven-day offsets R5 fixes", () => {
    expect(LAPSE_REMINDER_DAY_OFFSETS).toEqual({ day1: 1, day7: 7 })
  })

  // R14's placeholder copy, pinned verbatim. The stakeholder still has to sign
  // it off, and this is where a swap announces itself.
  it("carries the two fixed English strings R14 fixes", () => {
    expect(LAPSE_REMINDER_COPY).toEqual({
      day1: "Pick up where you left off.",
      day7: "Your video is still here whenever you are ready.",
    })
  })

  it("never lets the copy name the video", () => {
    // The machine-checkable half of R14: no interpolation, so no slug or title
    // can reach a notification a stranger may read over a shoulder.
    for (const copy of Object.values(LAPSE_REMINDER_COPY)) {
      expect(copy).not.toMatch(/[{}$]|%[sd]/)
    }
  })

  it("keeps the two reminder identifiers distinct", () => {
    // One identifier for both kinds would make the second schedule replace the
    // first, and R5's pair would silently become one reminder.
    expect(LAPSE_REMINDER_IDENTIFIERS.day1).not.toBe(
      LAPSE_REMINDER_IDENTIFIERS.day7,
    )
  })
})

describe("snapIntoReminderWindow", () => {
  it("moves a time before 09:00 to 09:00 the same day", () => {
    const snapped = snapIntoReminderWindow(new Date(at(2026, 9, 16, 3, 15)))

    expect(fields(snapped)).toEqual({
      year: 2026,
      month: 9,
      day: 16,
      hour: 9,
      minute: 0,
    })
  })

  it("moves 21:00 exactly to 09:00 the next day", () => {
    const snapped = snapIntoReminderWindow(new Date(at(2026, 9, 16, 21, 0)))

    expect(fields(snapped)).toEqual({
      year: 2026,
      month: 9,
      day: 17,
      hour: 9,
      minute: 0,
    })
  })

  it("leaves 20:59 alone", () => {
    const inside = at(2026, 9, 16, 20, 59)

    expect(snapIntoReminderWindow(new Date(inside)).getTime()).toBe(inside)
  })

  it("leaves 09:00 exactly alone", () => {
    // The start hour is inclusive. Snapping it would move a legitimate target
    // forward for no reason.
    const inside = at(2026, 9, 16, 9, 0)

    expect(snapIntoReminderWindow(new Date(inside)).getTime()).toBe(inside)
  })

  it("starts a snapped target on the minute", () => {
    const snapped = snapIntoReminderWindow(
      new Date(at(2026, 9, 16, 23, 30, 45, 123)),
    )

    expect(snapped.getSeconds()).toBe(0)
    expect(snapped.getMilliseconds()).toBe(0)
  })

  it("never returns an earlier instant, at any minute of a day", () => {
    // R6: delivered at or after the target, never before it. One counterexample
    // anywhere in the day breaks the requirement.
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const target = at(2026, 9, 16, 0, minute)
      expect(
        snapIntoReminderWindow(new Date(target)).getTime(),
      ).toBeGreaterThanOrEqual(target)
    }
  })

  it("crosses a month boundary when it snaps past midnight", () => {
    const snapped = snapIntoReminderWindow(new Date(at(2026, 9, 30, 22, 0)))

    expect(fields(snapped)).toEqual({
      year: 2026,
      month: 10,
      day: 1,
      hour: 9,
      minute: 0,
    })
  })
})

describe("computeLapseReminderTargets", () => {
  // Covers AE1.
  it("puts Monday 20:30 on Tuesday 20:30 and the following Monday 20:30", () => {
    const targets = computeLapseReminderTargets(at(2026, 9, 14, 20, 30))

    expect(fields(targets.day1)).toEqual({
      year: 2026,
      month: 9,
      day: 15,
      hour: 20,
      minute: 30,
    })
    expect(fields(targets.day7)).toEqual({
      year: 2026,
      month: 9,
      day: 21,
      hour: 20,
      minute: 30,
    })
  })

  // Covers AE3.
  it("puts a 23:30 last use on 09:00 two calendar days later for day 1", () => {
    const targets = computeLapseReminderTargets(at(2026, 9, 14, 23, 30))

    expect(fields(targets.day1)).toEqual({
      year: 2026,
      month: 9,
      day: 16,
      hour: 9,
      minute: 0,
    })
    // The same snap applies to day 7, which is the half a day-1-only fix
    // would leave behind.
    expect(fields(targets.day7)).toEqual({
      year: 2026,
      month: 9,
      day: 22,
      hour: 9,
      minute: 0,
    })
  })

  it("puts an 08:00 last use on 09:00 the next day, not 08:00", () => {
    const targets = computeLapseReminderTargets(at(2026, 9, 14, 8, 0))

    expect(fields(targets.day1)).toEqual({
      year: 2026,
      month: 9,
      day: 15,
      hour: 9,
      minute: 0,
    })
  })

  it("puts a 21:00 last use on 09:00 the next day", () => {
    const targets = computeLapseReminderTargets(at(2026, 9, 14, 21, 0))

    expect(fields(targets.day1)).toEqual({
      year: 2026,
      month: 9,
      day: 16,
      hour: 9,
      minute: 0,
    })
  })

  it("leaves a 20:59 last use at 20:59", () => {
    const targets = computeLapseReminderTargets(at(2026, 9, 14, 20, 59))

    expect(fields(targets.day1)).toEqual({
      year: 2026,
      month: 9,
      day: 15,
      hour: 20,
      minute: 59,
    })
  })

  it("keeps the wall-clock second and millisecond when it does not snap", () => {
    const targets = computeLapseReminderTargets(
      at(2026, 9, 14, 20, 30, 45, 123),
    )

    expect(targets.day1.getSeconds()).toBe(45)
    expect(targets.day1.getMilliseconds()).toBe(123)
  })

  it("crosses a month and a year boundary by the calendar", () => {
    const targets = computeLapseReminderTargets(at(2026, 12, 28, 20, 30))

    expect(fields(targets.day1)).toEqual({
      year: 2026,
      month: 12,
      day: 29,
      hour: 20,
      minute: 30,
    })
    expect(fields(targets.day7)).toEqual({
      year: 2027,
      month: 1,
      day: 4,
      hour: 20,
      minute: 30,
    })
  })

  it("orders day 1 before day 7, and both after the last use", () => {
    const lastUse = at(2026, 9, 14, 20, 30)
    const targets = computeLapseReminderTargets(lastUse)

    expect(targets.day1.getTime()).toBeGreaterThan(lastUse)
    expect(targets.day7.getTime()).toBeGreaterThan(targets.day1.getTime())
  })

  it("produces two targets and nothing else (R5)", () => {
    const targets = computeLapseReminderTargets(at(2026, 9, 14, 20, 30))

    expect(Object.keys(targets).sort()).toEqual(["day1", "day7"])
  })

  it("never returns a target at or before the last use, at any minute", () => {
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const lastUse = at(2026, 9, 14, 0, minute)
      const targets = computeLapseReminderTargets(lastUse)
      expect(targets.day1.getTime()).toBeGreaterThan(lastUse)
      expect(targets.day7.getTime()).toBeGreaterThan(targets.day1.getTime())
    }
  })
})

const zoneChangeWorks = timeZoneChangeWorks()
const describeZone = zoneChangeWorks ? describe : describe.skip

describeZone(
  zoneChangeWorks
    ? "across the Pacific/Auckland daylight-saving change"
    : "across the Pacific/Auckland daylight-saving change (SKIPPED: this runtime ignores a mid-process TZ change)",
  () => {
    let original: string | undefined

    beforeAll(() => {
      original = process.env.TZ
      setTimeZone(AUCKLAND)
    })

    afterAll(() => {
      setTimeZone(original)
    })

    it("straddles the change, so the case can discriminate", () => {
      // Anti-vacuous: without the zone in force both offsets would agree and
      // every assertion below would pass on a wrong implementation.
      expect(new Date(2026, 8, 21, 20, 30).getTimezoneOffset()).toBe(-720)
      expect(new Date(2026, 8, 28, 20, 30).getTimezoneOffset()).toBe(-780)
    })

    it("keeps the local hour for the day-7 target", () => {
      const lastUse = at(2026, 9, 21, 20, 30)
      const targets = computeLapseReminderTargets(lastUse)

      expect(fields(targets.day7)).toEqual({
        year: 2026,
        month: 9,
        day: 28,
        hour: 20,
        minute: 30,
      })
      // The discriminating assertion: calendar arithmetic spends an hour less
      // than seven days here. Adding milliseconds would land on 21:30 local.
      expect(targets.day7.getTime() - lastUse).toBe(7 * DAY_MS - HOUR_MS)
    })
  },
)
