// The daily-pause notification contract (KTD13): the payload of a daily reminder
// and its Android channel. A leaf, so the adapter and the tap both read it. The
// payload names no devotional, because a tap opens today's devotional (R1).

/** The discriminator the tap dispatches on, before the lapse branch. */
export const DAILY_PAUSE_REMINDER_FAMILY = "daily-pause"

/** Increase this when the payload shape changes. A pending reminder keeps the
 *  payload it was scheduled with, so an older one then opens Home. */
export const DAILY_PAUSE_REMINDER_PAYLOAD_VERSION = 1

/** The Android channel. Viewer-visible in the notification settings. */
export const DAILY_PAUSE_REMINDER_CHANNEL_ID = "daily-pause"
export const DAILY_PAUSE_REMINDER_CHANNEL_NAME = "Daily Bible Pause"

/** Every reason a tap can log. The tap event facets on it, so it stays fixed. */
export const DAILY_PAUSE_REMINDER_PARSE_REASONS = [
  "not_an_object",
  "wrong_family",
  "version_mismatch",
] as const

export type DailyPauseReminderParseReason =
  (typeof DAILY_PAUSE_REMINDER_PARSE_REASONS)[number]

export type DailyPauseReminderPayload = {
  version: number
  family: typeof DAILY_PAUSE_REMINDER_FAMILY
}

export type DailyPauseReminderParseResult =
  | { ok: true }
  | { ok: false; reason: DailyPauseReminderParseReason }

export function buildDailyPauseReminderPayload(): DailyPauseReminderPayload {
  return {
    version: DAILY_PAUSE_REMINDER_PAYLOAD_VERSION,
    family: DAILY_PAUSE_REMINDER_FAMILY,
  }
}

/** Validates an arriving payload. It never throws. */
export function parseDailyPauseReminderPayload(
  data: unknown,
): DailyPauseReminderParseResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, reason: "not_an_object" }
  }
  const payload = data as Record<string, unknown>
  if (payload.family !== DAILY_PAUSE_REMINDER_FAMILY) {
    return { ok: false, reason: "wrong_family" }
  }
  if (payload.version !== DAILY_PAUSE_REMINDER_PAYLOAD_VERSION) {
    return { ok: false, reason: "version_mismatch" }
  }
  return { ok: true }
}
