/**
 * Due-time computation for the two lapse reminders (R5, R6, KTD3). Pure, and
 * deliberately free of any date library: the app ships none, and the whole
 * rule is calendar arithmetic in the device's own local time.
 */

import {
  LAPSE_REMINDER_DAY_OFFSETS,
  LAPSE_REMINDER_WINDOW_END_HOUR,
  LAPSE_REMINDER_WINDOW_START_HOUR,
  type LapseReminderKind,
} from "./constants"

export type LapseReminderTargets = Record<LapseReminderKind, Date>

/**
 * Adds whole calendar days and keeps the wall-clock time (KTD3). Adding
 * milliseconds instead would land an hour off across a daylight-saving change
 * on the platform that evaluates the trigger by calendar.
 */
function addCalendarDays(from: Date, days: number): Date {
  return new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + days,
    from.getHours(),
    from.getMinutes(),
    from.getSeconds(),
    from.getMilliseconds(),
  )
}

/** The window's opening instant on a given day. */
function windowStart(day: Date, dayOffset: number): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + dayOffset,
    LAPSE_REMINDER_WINDOW_START_HOUR,
    0,
    0,
    0,
  )
}

/**
 * Moves a target into R6's 09:00-21:00 local window. It only ever moves a
 * target later, never earlier, because a reminder must be delivered at or
 * after its target time.
 */
export function snapIntoReminderWindow(target: Date): Date {
  const hour = target.getHours()
  if (hour < LAPSE_REMINDER_WINDOW_START_HOUR) return windowStart(target, 0)
  if (hour >= LAPSE_REMINDER_WINDOW_END_HOUR) return windowStart(target, 1)
  return target
}

/**
 * The day-1 and day-7 targets for a last use, each snapped into the window.
 * The result is the whole of R5: two targets, never a third.
 */
export function computeLapseReminderTargets(
  lastUsedAt: number,
): LapseReminderTargets {
  const lastUse = new Date(lastUsedAt)
  return {
    day1: snapIntoReminderWindow(
      addCalendarDays(lastUse, LAPSE_REMINDER_DAY_OFFSETS.day1),
    ),
    day7: snapIntoReminderWindow(
      addCalendarDays(lastUse, LAPSE_REMINDER_DAY_OFFSETS.day7),
    ),
  }
}
