import type { DevotionalLang } from "./devotional-locale"

/**
 * Fixed-date (MM-DD) occasion tags shown on the cover card AND spoken by the
 * narrator — opt-in per calendar date, most days have none. Curated (not
 * machine-translated) so both language versions read naturally, same
 * principle as scripture text: never auto-translate a fixed phrase.
 *
 * Movable feasts (Easter, Pentecost) need a computed liturgical calendar and
 * are intentionally out of scope here — only fixed MM-DD dates.
 */
const OCCASION_TABLE: Record<string, Record<DevotionalLang, string>> = {
  "08-19": {
    en: "World Humanitarian Day",
    ru: "Всемирный день гуманитарной помощи",
  },
}

/** Look up an occasion by ISO date (YYYY-MM-DD) + language; null if none configured. */
export function occasionFor(
  isoDate: string,
  lang: DevotionalLang,
): string | null {
  const key = isoDate.slice(5, 10)
  return OCCASION_TABLE[key]?.[lang] ?? null
}
