/**
 * Per-language configuration for the daily devotional (the localization seam).
 *
 * The devotional is GENERATED in English (grounded in English public-domain
 * reflections), then localized: a translate step converts the copy, the
 * scripture is swapped for a real target-language Bible (never machine
 * translated), the JESUS-film clip is pulled in the target language, and the
 * spoken connectors + on-screen labels + date come from here.
 *
 * Add a language by adding a `DevotionalLocale` and registering it in `LOCALES`.
 */

import type { DevotionalVoiceName } from "./elevenlabs-voiceover"
import { ruOrdinalDay, ruSpokenReference } from "./ru-numbers"
import { normalizeRuDashes, ruAuthorName } from "./ru-punctuation"

export type DevotionalLang = "en" | "ru"

export type DevotionalLabels = {
  /** Eyebrow above the reflection (first reflection card). */
  reflect: string
  /** Eyebrow above the closing question(s). */
  askYourself: string
  /** Eyebrow above the guided prayer. */
  pray: string
}

export type DevotionalConnectors = {
  /**
   * Cover: weekday+date then the hook (worded so "today" isn't doubled).
   * `occasion` is an optional fixed-date tag (e.g. "World Humanitarian Day")
   * from `devotional-occasions.ts`, spoken only on configured dates.
   */
  cover: (hook: string, date?: string | null, occasion?: string | null) => string
  /** Scripture card, ending with the lead-in to the video clip. */
  scripture: (ref: string, verse: string) => string
  /** Opens the FIRST reflection card only. */
  reflectionOpen: (chunk: string) => string
  /** Closing takeaway line (spoken as-is). */
  conclusion: (line: string) => string
  /** Question + invitation-to-pray, narrated together on one card. */
  questions: (question: string, prayer: string) => string
}

export type DevotionalLocale = {
  lang: DevotionalLang
  /** Arclight audio language id for the JESUS-film clip (en=529, ru=3934). */
  filmLanguageId: number
  /** Narration voice: a fixed ElevenLabs voice, or "rotate" (per-sequence, en). */
  voice: DevotionalVoiceName | "rotate"
  /**
   * Strip em/en dashes from generated copy? They read as an AI tell in ENGLISH;
   * in Russian the em dash (тире) is standard punctuation, so this is OFF for ru.
   */
  stripDashes: boolean
  /** On-screen section labels. */
  labels: DevotionalLabels
  /** Cover attribution prefix, before "· <author>" (author name stays as-is). */
  attributionPrefix: string
  /**
   * Owner-curated stress fixes for the NARRATION (spoken only, never displayed):
   * [plain → accented] pairs applied deterministically before TTS. Grow as
   * mis-stressings surface; use phrases where a word's stress is ambiguous.
   */
  stressOverrides?: ReadonlyArray<readonly [string, string]>
  /**
   * Deterministic typography fix-up for TRANSLATED copy (title/reflection/
   * conclusion/question/prayer — never scripture). Applied after the native
   * editor pass. Identity when absent. E.g. Russian spaces the em dash.
   */
  normalizeCopy?: (text: string) => string
  /**
   * Render a reflection author's name in the target language for the cover
   * attribution (e.g. "Matthew Henry" → "Мэтью Генри"). Identity when absent.
   */
  localizeAuthor?: (name: string) => string
  /** Spoken date, e.g. "Thursday, July 16" / "четверг, 16 июля" (null if unparseable). */
  spokenDate: (isoDate: string) => string | null
  /** Scripture citation prepared for speech (e.g. numbers spelled out). */
  spokenReference: (reference: string) => string
  /** On-screen cover date, e.g. "Thursday · July 16" / "Четверг · 16 июля". */
  coverDate: (isoDate: string) => string | null
  /** Spoken connective phrases that tie the sections into one flowing script. */
  connectors: DevotionalConnectors
}

function parseIso(isoDate: string): { y: number; m: number; d: number } | null {
  const m = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

/** Local-time weekday index (0=Sun). Local (not `new Date(iso)`, which is UTC). */
function weekdayIndex(p: { y: number; m: number; d: number }): number {
  return new Date(p.y, p.m - 1, p.d).getDay()
}

// ---- English (the default; current behavior) --------------------------------

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const EN_WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
]

export const EN_LOCALE: DevotionalLocale = {
  lang: "en",
  filmLanguageId: 529,
  voice: "rotate",
  stripDashes: true,
  labels: { reflect: "Reflect", askYourself: "Ask yourself", pray: "Pray" },
  attributionPrefix: "Adapted from a trusted classic",
  spokenDate(iso) {
    const p = parseIso(iso)
    if (!p) return null
    return `${EN_WEEKDAYS[weekdayIndex(p)]}, ${EN_MONTHS[p.m - 1]} ${p.d}`
  },
  coverDate(iso) {
    const p = parseIso(iso)
    if (!p) return null
    return `${EN_WEEKDAYS[weekdayIndex(p)]} · ${EN_MONTHS[p.m - 1]} ${p.d}`
  },
  // English TTS reads "Luke 19:10" fine — no change needed.
  spokenReference: (r) => r,
  connectors: {
    cover: (hook, date, occasion) => {
      const occasionLine = occasion ? ` Today is also ${occasion}.` : ""
      return date
        ? `It's ${date}.${occasionLine} And today's devotional: ${hook}`
        : `Today's devotional. ${hook}`
    },
    scripture: (ref, verse) =>
      `Here's today's scripture. ${ref ? `${ref}. ` : ""}${verse} Let's watch.`,
    reflectionOpen: (chunk) => `Reflect on this. ${chunk}`,
    conclusion: (line) => line,
    questions: (question, prayer) =>
      [`Here's something to sit with.`, question, prayer]
        .filter(Boolean)
        .join("\n\n"),
  },
}

// ---- Russian ----------------------------------------------------------------
// FIRST-DRAFT wording — owner (native speaker) to review/tweak. Months are in
// the GENITIVE case ("16 июля" = "the 16th of July"). No dash-stripping (тире is
// correct Russian punctuation, not an AI tell).

const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
]
// Capitalized: each use is sentence-initial (spoken cover) or a standalone
// label (on-screen date), where Russian weekday names take a capital.
const RU_WEEKDAYS = [
  "Воскресенье", "Понедельник", "Вторник", "Среда",
  "Четверг", "Пятница", "Суббота",
]

export const RU_LOCALE: DevotionalLocale = {
  lang: "ru",
  filmLanguageId: 3934,
  voice: "russian",
  stripDashes: false,
  labels: { reflect: "Подумай", askYourself: "Спроси себя", pray: "Помолись" },
  attributionPrefix: "По мотивам христианской классики",
  // Combining acute accent (U+0301) forces the correct stress for the voice.
  // "стоит" is phrase-scoped (stands, not "is worth"); grow this list as needed.
  stressOverrides: [
    ["потерянных", "поте́рянных"],
    ["стоит в стороне", "стои́т в стороне"],
    ["Того, Кто", "Того́, Кто"],
    ["я тону", "я тону́"],
    ["коробов", "коробо́в"],
    ["к Тому, Кто", "к Тому́, Кто"],
    ["самом ожесточённом", "са́мом ожесточённом"],
  ],
  spokenDate(iso) {
    const p = parseIso(iso)
    if (!p) return null
    // Ordinal day spelled out ("семнадцатое"), so TTS doesn't say the cardinal.
    return `${RU_WEEKDAYS[weekdayIndex(p)]}, ${ruOrdinalDay(p.d)} ${RU_MONTHS[p.m - 1]}`
  },
  coverDate(iso) {
    const p = parseIso(iso)
    if (!p) return null
    // On-screen keeps the digit: "Пятница · 17 июля".
    return `${RU_WEEKDAYS[weekdayIndex(p)]} · ${p.d} ${RU_MONTHS[p.m - 1]}`
  },
  spokenReference: ruSpokenReference,
  normalizeCopy: normalizeRuDashes,
  localizeAuthor: ruAuthorName,
  connectors: {
    // Owner: date first ("Сегодня <weekday>, <date>"), then a gentle spoken
    // lead-in that invites the viewer to slow down, then the hook as the
    // opening line of the story.
    cover: (hook, date, occasion) => {
      const occasionLine = occasion ? `Сегодня отмечается ${occasion}.\n\n` : ""
      return date
        ? `Сегодня ${date}.\n\n${occasionLine}Сделай небольшую паузу. Давай поразмышляем над Божьим Словом.\n\n${hook}`
        : `Давай поразмышляем над Божьим Словом.\n\n${hook}`
    },
    // The verse is set apart with paragraph breaks (→ pauses), so there is a
    // clear beat after the verse before the lead-in to the clip.
    scripture: (ref, verse) =>
      `Вот отрывок из Писания.${ref ? ` ${ref}.` : ""}\n\n${verse}\n\nДавайте посмотрим.`,
    reflectionOpen: (chunk) => `Подумай над этим. ${chunk}`,
    conclusion: (line) => line,
    questions: (question, prayer) =>
      [`Задумайся вот о чём.`, question, prayer].filter(Boolean).join("\n\n"),
  },
}

export const LOCALES: Record<DevotionalLang, DevotionalLocale> = {
  en: EN_LOCALE,
  ru: RU_LOCALE,
}

export function localeFor(lang: DevotionalLang): DevotionalLocale {
  return LOCALES[lang] ?? EN_LOCALE
}
