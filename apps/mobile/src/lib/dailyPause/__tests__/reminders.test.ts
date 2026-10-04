/**
 * The daily reminders (U12, KTD13, R32, R33, R35, R36). The lifecycle runs over
 * a fake adapter whose pending set replaces by identifier, as the OS does, and
 * over the REAL settings store, so a setting change reaches it the real way.
 */

// The default wiring reaches the real adapter; every case here injects a fake.
jest.mock("../../lapseReminders/notificationsAdapter", () => ({
  lapseReminderNotifications: {},
}))

import { Linking, type PlatformOSType } from "react-native"

import { DEVOTIONALS } from "../devotionals"
import {
  dayFromRecord,
  getPauseProgressStore,
  resetPauseProgressStoreForTests,
} from "../progress"
import {
  buildDailyPauseReminders,
  createDailyPauseReminderLifecycle,
  openNotificationSettings,
  turnOnDailyPauseReminders,
  type DailyPauseReminderRequest,
} from "../reminders"
import { createPauseSettingsStore } from "../settings"

const DAY_MS = 24 * 60 * 60 * 1000

/** 6:00 AM on Monday 5 October 2026, a Pharisee day (AE3). */
const MONDAY_6AM = new Date(2026, 9, 5, 6, 0).getTime()

const SEVEN = { hour: 7, minute: 0 }
const SIX_THIRTY = { hour: 6, minute: 30 }

type Permission = { granted: boolean; canAskAgain: boolean }

/** Day keys from the test's own UTC arithmetic, not from the code under test. */
function dayKeys(from: string, count: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * DAY_MS).toISOString().slice(0, 10),
  )
}

function identifiers(from: string, count: number): string[] {
  return dayKeys(from, count).map((key) => `daily-pause-${key}`)
}

/** The local calendar day of a date, written here rather than imported. */
function localKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** The local wall-clock time a request fires at, on either trigger. */
function wallClock(request: DailyPauseReminderRequest): string {
  const { hour, minute } =
    "calendar" in request
      ? request.calendar
      : { hour: request.date.getHours(), minute: request.date.getMinutes() }
  return `${hour}:${String(minute).padStart(2, "0")}`
}

/** The first local day whose UTC offset differs from the day before, if any. */
function firstDaylightSavingChange(): Date | null {
  for (let day = 1; day <= 730; day += 1) {
    const before = new Date(2026, 0, day - 1, 12).getTimezoneOffset()
    const noon = new Date(2026, 0, day, 12)
    if (noon.getTimezoneOffset() !== before) return noon
  }
  return null
}

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

/** Every fake call resolves at once, so all chained passes settle first. */
function idle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

type HarnessOptions = {
  now?: number
  platform?: PlatformOSType
  permission?: Permission
}

function harness({
  now = MONDAY_6AM,
  platform = "ios",
  permission = { granted: true, canAskAgain: false },
}: HarnessOptions = {}) {
  // The OS's pending set: a schedule under a pending identifier replaces it.
  const pending = new Map<string, DailyPauseReminderRequest>()
  const order: string[] = []
  let current = permission
  let promptAnswer = permission
  let clock = now
  const adapter = {
    ensureDailyPauseChannel: jest.fn(async () => {
      order.push("channel")
    }),
    getPermission: jest.fn(async () => current),
    requestPermission: jest.fn(async () => {
      order.push("request")
      current = promptAnswer
      return promptAnswer
    }),
    schedule: jest.fn(async (request: DailyPauseReminderRequest) => {
      pending.set(request.identifier, request)
    }),
    cancel: jest.fn(async (identifier: string) => {
      pending.delete(identifier)
    }),
  }
  const settings = createPauseSettingsStore(memoryStorage())
  const appState = new Set<(state: string) => void>()
  const lifecycle = createDailyPauseReminderLifecycle({
    adapter,
    settings,
    subscribeToAppState: (listener) => {
      appState.add(listener)
      return () => {
        appState.delete(listener)
      }
    },
    now: () => clock,
    platform,
  })
  return {
    adapter,
    pending,
    order,
    settings,
    lifecycle,
    setNow: (next: number) => {
      clock = next
    },
    setPermission: (next: Permission) => {
      current = next
    },
    answerPromptWith: (next: Permission) => {
      promptAnswer = next
    },
    emitAppState: (state: string) => {
      for (const listener of [...appState]) listener(state)
    },
    appStateListenerCount: () => appState.size,
    dailyPending: () =>
      [...pending.keys()].filter((id) => id.startsWith("daily-pause-")).sort(),
  }
}

describe("buildDailyPauseReminders", () => {
  it("holds 14 requests at 7:00 AM, one per local day, each naming that day's question (AE3)", () => {
    const requests = buildDailyPauseReminders(MONDAY_6AM, SEVEN, "android")

    expect(requests.map((request) => request.identifier)).toEqual(
      identifiers("2026-10-05", 14),
    )
    // Monday 5 October is a Pharisee day, and the two alternate from it (R4).
    expect(requests[0].body).toBe(DEVOTIONALS.pharisee.question)
    expect(requests[1].body).toBe(DEVOTIONALS.lamp.question)
    expect(requests.map((request) => request.body)).toEqual(
      requests.map((_, index) =>
        index % 2 === 0
          ? DEVOTIONALS.pharisee.question
          : DEVOTIONALS.lamp.question,
      ),
    )
    for (const request of requests) expect(wallClock(request)).toBe("7:00")
  })

  it("titles each request and carries the daily-pause payload and channel", () => {
    const [first] = buildDailyPauseReminders(MONDAY_6AM, SEVEN, "android")

    expect(first).toMatchObject({
      title: "Daily Bible Pause",
      data: { version: 1, family: "daily-pause" },
      channelId: "daily-pause",
    })
  })

  it("starts tomorrow once today's time has come", () => {
    const sevenAm = new Date(2026, 9, 5, 7, 0).getTime()

    expect(
      buildDailyPauseReminders(sevenAm, SEVEN, "ios").map(
        (request) => request.identifier,
      ),
    ).toEqual(identifiers("2026-10-06", 14))
  })

  it("uses the calendar trigger on iOS, with months counted 1 to 12", () => {
    const [first] = buildDailyPauseReminders(MONDAY_6AM, SEVEN, "ios")

    // The module hands these components to iOS unchanged (CalendarTriggerRecord
    // in TriggerRecords.swift), and iOS date components count months from 1.
    expect(first).toMatchObject({
      calendar: { year: 2026, month: 10, day: 5, hour: 7, minute: 0 },
    })
    expect("date" in first).toBe(false)
  })

  it("uses the date trigger on Android", () => {
    const [first] = buildDailyPauseReminders(MONDAY_6AM, SEVEN, "android")

    expect("calendar" in first).toBe(false)
    expect("date" in first && first.date.getTime()).toBe(
      new Date(2026, 9, 5, 7, 0).getTime(),
    )
  })

  it("crosses a year end on the calendar", () => {
    const requests = buildDailyPauseReminders(
      new Date(2026, 11, 30, 6, 0).getTime(),
      SEVEN,
      "ios",
    )

    expect(requests.map((request) => request.identifier)).toEqual(
      identifiers("2026-12-30", 14),
    )
    expect(requests[2]).toMatchObject({
      calendar: { year: 2027, month: 1, day: 1 },
    })
  })

  it("keeps the wall-clock time and one request per day across a daylight-saving change", () => {
    // Bites only in a zone with daylight saving, as the machine's own zone is.
    const change = firstDaylightSavingChange() ?? new Date(2026, 9, 20, 12)
    const now = new Date(
      change.getFullYear(),
      change.getMonth(),
      change.getDate() - 3,
      6,
      0,
    )
    const requests = buildDailyPauseReminders(
      now.getTime(),
      SIX_THIRTY,
      "android",
    )
    const keys = dayKeys(localKey(now), 14)

    expect(requests.map((request) => request.identifier)).toEqual(
      keys.map((key) => `daily-pause-${key}`),
    )
    expect(
      requests.map((request) => "date" in request && localKey(request.date)),
    ).toEqual(keys)
    for (const request of requests) expect(wallClock(request)).toBe("6:30")
  })
})

describe("the reminder lifecycle", () => {
  it("schedules the 14 requests when Notifications are on (R32)", async () => {
    const h = harness()
    h.settings.update({ reminderOn: true })

    h.lifecycle.attach()
    await idle()

    expect(h.dailyPending()).toEqual(identifiers("2026-10-05", 14))
  })

  it("replaces every request under the same identifiers for a new time (F3)", async () => {
    const h = harness({ now: new Date(2026, 9, 5, 5, 0).getTime() })
    h.settings.update({ reminderOn: true })
    h.lifecycle.attach()
    await idle()
    const before = h.dailyPending()
    expect(before).toHaveLength(14)

    h.settings.update({ reminderTime: SIX_THIRTY })
    await idle()

    expect(h.dailyPending()).toEqual(before)
    for (const id of before) {
      expect(wallClock(h.pending.get(id) as DailyPauseReminderRequest)).toBe(
        "6:30",
      )
    }
    // Replaced in place: no pending identifier was cancelled on the way.
    const cancelled = h.adapter.cancel.mock.calls.map(([id]) => id)
    expect(cancelled.filter((id) => before.includes(id))).toEqual([])
  })

  it("drops today's request when the new time has already passed today", async () => {
    const h = harness({ now: new Date(2026, 9, 5, 6, 45).getTime() })
    h.settings.update({ reminderOn: true })
    h.lifecycle.attach()
    await idle()
    expect(h.pending.has("daily-pause-2026-10-05")).toBe(true)

    h.settings.update({ reminderTime: SIX_THIRTY })
    await idle()

    expect(h.dailyPending()).toEqual(identifiers("2026-10-06", 14))
  })

  it("cancels only its own identifiers when Notifications turn off", async () => {
    const h = harness()
    const lapse = {
      identifier: "lapse",
    } as unknown as DailyPauseReminderRequest
    h.pending.set("lapse-reminder-day1", lapse)
    h.pending.set("lapse-reminder-day7", lapse)
    h.settings.update({ reminderOn: true })
    h.lifecycle.attach()
    await idle()
    expect(h.dailyPending()).toHaveLength(14)

    h.settings.update({ reminderOn: false })
    await idle()

    expect([...h.pending.keys()].sort()).toEqual([
      "lapse-reminder-day1",
      "lapse-reminder-day7",
    ])
  })

  it("reschedules when the app returns to the foreground, and only then", async () => {
    const h = harness()
    h.settings.update({ reminderOn: true })
    h.lifecycle.attach()
    await idle()
    h.setNow(new Date(2026, 9, 6, 6, 0).getTime())

    h.emitAppState("inactive")
    h.emitAppState("background")
    await idle()
    expect(h.pending.has("daily-pause-2026-10-19")).toBe(false)

    h.emitAppState("active")
    await idle()
    expect(h.dailyPending()).toEqual(identifiers("2026-10-06", 14))
  })

  it("cancels its requests once permission is gone", async () => {
    const h = harness()
    h.settings.update({ reminderOn: true })
    h.lifecycle.attach()
    await idle()
    expect(h.dailyPending()).toHaveLength(14)

    h.setPermission({ granted: false, canAskAgain: false })
    h.emitAppState("active")
    await idle()

    expect(h.dailyPending()).toEqual([])
  })

  it("stops rescheduling once it is detached", async () => {
    const h = harness()
    const detach = h.lifecycle.attach()
    await idle()

    detach()
    h.settings.update({ reminderOn: true })
    h.emitAppState("active")
    await idle()

    expect(h.adapter.schedule).not.toHaveBeenCalled()
    expect(h.appStateListenerCount()).toBe(0)
  })
})

describe("a day already done (R32)", () => {
  beforeEach(() => {
    resetPauseProgressStoreForTests()
  })

  it("still has its request", async () => {
    // Through the app's REAL day record, so a pass that learned to skip a done
    // day would read this record. With no storage here, it lives in memory.
    const progress = getPauseProgressStore()
    await progress.hydrate()
    progress.markDone("2026-10-05")
    expect(dayFromRecord(progress.getSnapshot(), "2026-10-05").done).toBe(true)
    const h = harness()
    h.settings.update({ reminderOn: true })

    h.lifecycle.attach()
    await idle()

    expect(h.pending.has("daily-pause-2026-10-05")).toBe(true)
  })
})

describe("turnOnDailyPauseReminders (R35, R36)", () => {
  it("asks when the app has no permission, and a grant schedules the requests", async () => {
    const h = harness({ permission: { granted: false, canAskAgain: true } })
    h.answerPromptWith({ granted: true, canAskAgain: false })
    h.lifecycle.attach()
    await idle()

    const result = await turnOnDailyPauseReminders({
      adapter: h.adapter,
      settings: h.settings,
    })
    await idle()

    expect(result).toBe("on")
    expect(h.adapter.requestPermission).toHaveBeenCalledTimes(1)
    expect(h.settings.getSnapshot().reminderOn).toBe(true)
    expect(h.dailyPending()).toEqual(identifiers("2026-10-05", 14))
    // KTD6's precedent: Android 13 shows no prompt until a channel exists.
    expect(h.order.indexOf("channel")).toBeLessThan(h.order.indexOf("request"))
  })

  it("leaves the switch off and schedules nothing on a denial (AE6)", async () => {
    const h = harness({ permission: { granted: false, canAskAgain: true } })
    h.answerPromptWith({ granted: false, canAskAgain: false })
    h.lifecycle.attach()
    await idle()

    const result = await turnOnDailyPauseReminders({
      adapter: h.adapter,
      settings: h.settings,
    })
    await idle()

    expect(result).toBe("denied")
    expect(h.adapter.requestPermission).toHaveBeenCalledTimes(1)
    expect(h.settings.getSnapshot().reminderOn).toBe(false)
    expect(h.adapter.schedule).not.toHaveBeenCalled()
  })

  it("turns on with no prompt when the app already has permission", async () => {
    const h = harness()

    const result = await turnOnDailyPauseReminders({
      adapter: h.adapter,
      settings: h.settings,
    })

    expect(result).toBe("on")
    expect(h.adapter.requestPermission).not.toHaveBeenCalled()
    expect(h.settings.getSnapshot().reminderOn).toBe(true)
  })

  it("reports denied with no prompt when the system cannot ask again", async () => {
    const h = harness({ permission: { granted: false, canAskAgain: false } })

    const result = await turnOnDailyPauseReminders({
      adapter: h.adapter,
      settings: h.settings,
    })

    expect(result).toBe("denied")
    expect(h.adapter.requestPermission).not.toHaveBeenCalled()
    expect(h.settings.getSnapshot().reminderOn).toBe(false)
  })
})

describe("openNotificationSettings", () => {
  it("opens the app's own page in Settings (KTD13)", async () => {
    const open = jest.spyOn(Linking, "openSettings").mockResolvedValue()

    await openNotificationSettings()

    expect(open).toHaveBeenCalledTimes(1)
  })
})
