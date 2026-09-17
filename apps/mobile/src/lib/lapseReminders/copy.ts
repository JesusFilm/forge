/**
 * The one place a reminder body is built (R14a). Pure, so the titled and
 * untitled forms are both reachable from a test without a native module.
 */

import {
  LAPSE_REMINDER_COPY,
  LAPSE_REMINDER_COPY_TITLED,
  LAPSE_REMINDER_TITLE_TOKEN,
  type LapseReminderKind,
} from "./constants"

/**
 * The body for one reminder. A null or blank title takes the untitled form,
 * so a record written before titles still reads as a finished sentence.
 */
export function lapseReminderBody(
  kind: LapseReminderKind,
  videoTitle: string | null,
): string {
  const title = videoTitle == null ? "" : videoTitle.trim()
  if (title.length === 0) return LAPSE_REMINDER_COPY[kind]
  return LAPSE_REMINDER_COPY_TITLED[kind]
    .split(LAPSE_REMINDER_TITLE_TOKEN)
    .join(title)
}
