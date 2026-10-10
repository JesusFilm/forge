/** The one place a reminder body is built (R14a). It reads the catalog in use
 *  when a pass schedules, so a pending reminder keeps the language it was
 *  scheduled in, as it keeps its title. */

import { getCatalogTag } from "../../i18n/localeStore"
import { getT, type UiMessageKey } from "../../i18n/useT"
import type { LapseReminderKind } from "./constants"

type ReminderKey = UiMessageKey<"LapseReminder">

const UNTITLED: Record<LapseReminderKind, ReminderKey> = {
  day1: "day1Body",
  day7: "day7Body",
}

const TITLED: Record<LapseReminderKind, ReminderKey> = {
  day1: "day1TitledBody",
  day7: "day7TitledBody",
}

/** A record written before the title locale existed has an English title. */
const LEGACY_TITLE_LOCALE = "en"

/**
 * The body for one reminder. A null or blank title takes the untitled form,
 * so a record written before titles still reads as a finished sentence. A
 * title in another language than the UI takes it too (KTD16).
 */
export function lapseReminderBody(
  kind: LapseReminderKind,
  videoTitle: string | null,
  titleLocale?: string | null,
): string {
  const t = getT("LapseReminder")
  const title = videoTitle == null ? "" : videoTitle.trim()
  const sameLanguage = (titleLocale ?? LEGACY_TITLE_LOCALE) === getCatalogTag()
  if (title.length === 0 || !sameLanguage) return t(UNTITLED[kind])
  return t(TITLED[kind], { title })
}

/** The Android channel's name, in the UI language of the pass (KTD6). */
export function lapseReminderChannelName(): string {
  return getT("LapseReminder")("channelName")
}
