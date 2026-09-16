/**
 * Dependency-free constants for the lapse reminders. Every later reminder
 * module imports this leaf, so it holds no logic and no import. The
 * last-watched record owns its own storage key; it is not one of these.
 */

/**
 * R5's two kinds, in the order a pass schedules them. The schedule pass and the
 * payload parser read this one array, so a third kind can never reach one half
 * of the contract and not the other.
 */
export const LAPSE_REMINDER_KINDS = ["day1", "day7"] as const

/** The two reminders R5 allows. Nothing schedules a third. */
export type LapseReminderKind = (typeof LAPSE_REMINDER_KINDS)[number]

/**
 * KTD8's single build-time switch, on one line as a bare literal so a reader
 * and lapseRemindersKillSwitch.guard both answer "is it on?" from this file.
 * Off still runs the pass, which cancels and dismisses; it never schedules.
 */
export const LAPSE_REMINDERS_ENABLED: boolean = true

/**
 * R14's fixed English copy. Placeholder until the ministry stakeholder signs
 * off. Neither string names the video, and neither is localized: the app's own
 * UI is English-only today.
 */
export const LAPSE_REMINDER_COPY: Record<LapseReminderKind, string> = {
  day1: "Pick up where you left off.",
  day7: "Your video is still here whenever you are ready.",
}

/** R6's delivery window in local time. The start hour is inclusive. */
export const LAPSE_REMINDER_WINDOW_START_HOUR = 9

/** R6's end hour, exclusive: a target at 21:00 already falls outside. */
export const LAPSE_REMINDER_WINDOW_END_HOUR = 21

/** R5's two lapse distances, in calendar days from the last use. */
export const LAPSE_REMINDER_DAY_OFFSETS: Record<LapseReminderKind, number> = {
  day1: 1,
  day7: 7,
}

/**
 * KTD6's Android channel. The plugin's `defaultChannel` option creates no
 * channel, so the adapter creates this one before the first permission
 * request, or Android 13 shows no prompt at all.
 */
export const LAPSE_REMINDER_CHANNEL_ID = "lapse-reminders"

/** Viewer-visible in the Android notification settings, so it reads plainly. */
export const LAPSE_REMINDER_CHANNEL_NAME = "Reminders"

/**
 * KTD2's two fixed identifiers. Scheduling under an identifier that is already
 * pending replaces it, which is how R5's two-at-most bound holds by
 * construction rather than by a cancel-then-schedule window.
 */
export const LAPSE_REMINDER_IDENTIFIERS: Record<LapseReminderKind, string> = {
  day1: "lapse-reminder-day1",
  day7: "lapse-reminder-day7",
}

/**
 * What the pass and the prompt need of a permission status. Narrower than the
 * module's own, which carries a platform surface neither one reads. It lives in
 * this leaf so the pure prompt never imports the adapter to name the shape.
 */
export type LapseReminderPermission = {
  granted: boolean
  canAskAgain: boolean
}

/**
 * KTD6's asked-once latch, in AsyncStorage beside the sign-in prompt latch.
 * The sign-out path clears the record and leaves this key, so a returning user
 * is never prompted twice.
 */
export const LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY =
  "lapse-reminders-permission-asked"

/**
 * KTD4's payload version. Reminders already pending on a device keep the
 * payload they were scheduled with (R2), so a bump makes an older pending
 * reminder land on Home rather than somewhere unintended.
 */
export const LAPSE_REMINDER_PAYLOAD_VERSION = 1
