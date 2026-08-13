/**
 * Editorial calendar: pins a specific JESUS-film chapter (+ sequence) to a
 * specific calendar date, so the daily job doesn't have to fall back to the
 * ledger's auto-rotation (`chooseChapter`) — which has NO awareness of dates
 * at all and would almost certainly pick a different chapter on any given day
 * than whatever the owner planned for that date.
 *
 * `sequence` is PINNED per date (not derived from the ledger's running count)
 * so a calendar day's cache key is stable regardless of how many OTHER
 * (non-calendar) devotionals get approved between now and that date — a
 * devotional rendered/cached today for a future date will still be found and
 * reused verbatim when that date actually arrives. Calendar sequences start
 * at 100 specifically to stay clear of the ledger's organic 0,1,2,... counter
 * used on non-calendar days.
 *
 * Seeded with the August 2026 plan's 8 chapters that already have a curated
 * clip window (see jesus-film-passages.ts) — the other ~23 planned days still
 * need clip curation before they can be added here; until then those dates
 * fall through to auto-pick like any other day.
 */

export type CalendarEntry = {
  chapterIndex: number
  sequence: number
}

export const AUGUST_2026_CALENDAR: Record<string, CalendarEntry> = {
  "2026-08-04": { chapterIndex: 5, sequence: 100 }, // The Devil Tempts Jesus
  "2026-08-07": { chapterIndex: 14, sequence: 101 }, // Sinful Woman Forgiven
  "2026-08-09": { chapterIndex: 19, sequence: 102 }, // Jesus Calms the Storm
  "2026-08-11": { chapterIndex: 21, sequence: 103 }, // Jesus Feeds 5,000
  "2026-08-19": { chapterIndex: 31, sequence: 104 }, // Good Samaritan (World Humanitarian Day)
  "2026-08-20": { chapterIndex: 33, sequence: 105 }, // Jesus and Zaccheus
  "2026-08-28": { chapterIndex: 55, sequence: 106 }, // Death of Jesus
  "2026-08-30": { chapterIndex: 59, sequence: 107 }, // Resurrected Jesus Appears
}

/** Look up the pinned chapter+sequence for an ISO date (YYYY-MM-DD); null if unplanned. */
export function calendarEntryFor(date: string): CalendarEntry | null {
  return AUGUST_2026_CALENDAR[date] ?? null
}
