// The daily reminders (U12, KTD13): 14 one-shot requests, one per local day at
// the chosen time, each naming that day's question from the day clock (KTD11).
// The lifecycle schedules them again on foreground and on each setting change.
import { Linking, type PlatformOSType } from "react-native"

import {
  lapseReminderNotifications,
  type ReminderCalendarDate,
  type ReminderScheduleInput,
} from "../lapseReminders/notificationsAdapter"
import { withTimeout } from "../withTimeout"
import { attachPassTriggers, createPassRunner } from "./passRunner"
import {
  DAILY_PAUSE_REMINDER_CHANNEL_ID,
  buildDailyPauseReminderPayload,
  type DailyPauseReminderPayload,
} from "./reminderPayload"
import {
  getPauseSettingsStore,
  type PauseSettingsStore,
  type ReminderTime,
} from "./settings"
import { devotionalForDay, localDay, onDay } from "./today"

/** R32: one request per local day, for this many days. */
export const DAILY_PAUSE_REMINDER_DAYS = 14

export const DAILY_PAUSE_REMINDER_IDENTIFIER_PREFIX = "daily-pause-"

export const DAILY_PAUSE_REMINDER_TITLE = "Daily Bible Pause"

/** A native call that never settles must not stop every later pass. */
export const DAILY_PAUSE_REMINDER_ADAPTER_DEADLINE_MS = 3_000

export type DailyPauseReminderRequest = ReminderScheduleInput & {
  title: string
  data: DailyPauseReminderPayload
  channelId: string
}

export type DailyPauseReminderPermission = {
  granted: boolean
  canAskAgain: boolean
}

/** The slice of the notifications adapter that the daily reminders use. */
export type DailyPauseReminderPort = {
  ensureDailyPauseChannel: () => Promise<void>
  getPermission: () => Promise<DailyPauseReminderPermission>
  requestPermission: () => Promise<DailyPauseReminderPermission>
  schedule: (request: DailyPauseReminderRequest) => Promise<void>
  cancel: (identifier: string) => Promise<void>
}

export function dailyPauseReminderIdentifier(dayKey: string): string {
  return `${DAILY_PAUSE_REMINDER_IDENTIFIER_PREFIX}${dayKey}`
}

function calendarDate(date: Date): ReminderCalendarDate {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  }
}

/** R32, R33: the next 14 reminders at the chosen time, from today while that
 *  time is still ahead, else from tomorrow. A done day keeps its reminder. */
export function buildDailyPauseReminders(
  nowMs: number,
  time: ReminderTime,
  platform: PlatformOSType,
): DailyPauseReminderRequest[] {
  const now = new Date(nowMs)
  const first = onDay(now, 0, time.hour, time.minute).getTime() > nowMs ? 0 : 1
  return Array.from({ length: DAILY_PAUSE_REMINDER_DAYS }, (_, index) => {
    const fireAt = onDay(now, first + index, time.hour, time.minute)
    const dayKey = localDay(fireAt)
    const request = {
      identifier: dailyPauseReminderIdentifier(dayKey),
      title: DAILY_PAUSE_REMINDER_TITLE,
      body: devotionalForDay(dayKey).question,
      data: buildDailyPauseReminderPayload(),
      channelId: DAILY_PAUSE_REMINDER_CHANNEL_ID,
    }
    return platform === "ios"
      ? { ...request, calendar: calendarDate(fireAt) }
      : { ...request, date: fireAt }
  })
}

/** Every identifier a pass may own: one day either side of the 14, so that a
 *  clock or zone change cannot leave a request pending. */
function ownedIdentifiers(nowMs: number): string[] {
  const now = new Date(nowMs)
  return Array.from({ length: DAILY_PAUSE_REMINDER_DAYS + 2 }, (_, index) =>
    dailyPauseReminderIdentifier(localDay(onDay(now, index - 1, 12, 0))),
  )
}

export type DailyPauseReminderLifecycleDeps = {
  adapter: Omit<DailyPauseReminderPort, "requestPermission">
  settings: Pick<PauseSettingsStore, "getSnapshot" | "subscribe" | "hydrate">
  subscribeToAppState: (listener: (state: string) => void) => () => void
  now: () => number
  platform: PlatformOSType
}

export type DailyPauseReminderLifecycle = {
  runPass: () => Promise<void>
  attach: () => () => void
}

function bounded<T>(promise: Promise<T>): Promise<T> {
  return withTimeout(promise, DAILY_PAUSE_REMINDER_ADAPTER_DEADLINE_MS)
}

export function createDailyPauseReminderLifecycle(
  deps: DailyPauseReminderLifecycleDeps,
): DailyPauseReminderLifecycle {
  async function runOnce() {
    // The defaults read as off, so a pass before the read would cancel all.
    await deps.settings.hydrate()
    const { reminderOn, reminderTime } = deps.settings.getSnapshot()
    const nowMs = deps.now()
    let requests: DailyPauseReminderRequest[] = []
    if (reminderOn && (await bounded(deps.adapter.getPermission())).granted) {
      await bounded(deps.adapter.ensureDailyPauseChannel())
      requests = buildDailyPauseReminders(nowMs, reminderTime, deps.platform)
    }
    // A schedule replaces the pending request under its identifier, so only
    // the identifiers left over need a cancel.
    for (const request of requests) {
      await bounded(deps.adapter.schedule(request))
    }
    const kept = new Set(requests.map((request) => request.identifier))
    for (const identifier of ownedIdentifiers(nowMs)) {
      if (!kept.has(identifier)) await bounded(deps.adapter.cancel(identifier))
    }
  }

  // A failed pass, a failed permission read included, cancels nothing more.
  const runPass = createPassRunner(runOnce)

  function attach(): () => void {
    // Only the switch and the time change the reminders, so a new Meditation
    // length asks for no pass.
    const reminderInputs = () => {
      const { reminderOn, reminderTime } = deps.settings.getSnapshot()
      return `${reminderOn}-${reminderTime.hour}:${reminderTime.minute}`
    }
    let lastInputs = reminderInputs()
    return attachPassTriggers({
      runPass,
      subscribeToAppState: deps.subscribeToAppState,
      subscribeToStore: (listener) =>
        deps.settings.subscribe(() => {
          const inputs = reminderInputs()
          if (inputs === lastInputs) return
          lastInputs = inputs
          listener()
        }),
    })
  }

  return { runPass, attach }
}

export type DailyPauseReminderSwitchDeps = {
  adapter: Pick<
    DailyPauseReminderPort,
    "ensureDailyPauseChannel" | "getPermission" | "requestPermission"
  >
  settings: Pick<PauseSettingsStore, "update">
}

function realSwitchDeps(): DailyPauseReminderSwitchDeps {
  return {
    adapter: lapseReminderNotifications,
    settings: getPauseSettingsStore(),
  }
}

/** R35, R36, for the Notifications switch: asks for permission when the app
 *  does not have it, and turns the switch on only after a grant. On "denied"
 *  the switch stays off. A failed permission call rejects. */
export async function turnOnDailyPauseReminders(
  deps: DailyPauseReminderSwitchDeps = realSwitchDeps(),
): Promise<"on" | "denied"> {
  // Android 13 shows no prompt until a channel exists (KTD6 of the lapse plan).
  await deps.adapter.ensureDailyPauseChannel()
  let permission = await deps.adapter.getPermission()
  if (!permission.granted && permission.canAskAgain) {
    permission = await deps.adapter.requestPermission()
  }
  if (!permission.granted) return "denied"
  deps.settings.update({ reminderOn: true })
  return "on"
}

/** KTD13: after a denial, the Settings line opens the app's own page. */
export function openNotificationSettings(): Promise<void> {
  return Linking.openSettings()
}
