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
import { fetchSynodalPassage } from "./synodal-bible"
import {
  esSpokenReference,
  fetchValeraPassage,
  modernizeValeraOrthography,
} from "./valera-bible"

export type DevotionalLang = "en" | "ru" | "es"

export type DevotionalLabels = {
  /** Eyebrow above the reflection (first reflection card). */
  reflect: string
  /** Eyebrow above the closing question(s). */
  askYourself: string
  /** Eyebrow above the guided prayer. */
  pray: string
  /** Spoken lead-ins on the closing card, before the question and before the
   *  prayer (owner, 2026-09-29). The card clocks its two blocks to them. */
  askLead?: string
  prayLead?: string
}

export type DevotionalConnectors = {
  /**
   * Cover: weekday+date then the hook (worded so "today" isn't doubled).
   * `occasion` is an optional fixed-date tag (e.g. "World Humanitarian Day")
   * from `devotional-occasions.ts`, spoken only on configured dates.
   */
  /** `sequence` rotates the settle line (English) the way it rotates voices. */
  cover: (
    hook: string,
    sequence: number,
    date?: string | null,
    occasion?: string | null,
    /** Replace the rotated settle line for THIS run. Used when a cut has to
     *  avoid a word the card after it already says. */
    settleOverride?: string | null,
    /** Speak the hook ALONE. With the stepper on, the settle line's job — ask
     *  the viewer to slow down — belongs to the stepper's own opening line,
     *  and hearing both back to back says the same thing twice. */
    omitSettle?: boolean,
  ) => string
  /**
   * Scripture card. `ref` is spoken here ONLY when the step card didn't say it
   * (steps on) — with steps off the READ connector still carries it, and this
   * is called with an empty ref so it isn't said twice.
   */
  scripture: (ref: string, verse: string) => string
  /** Opens the FIRST reflection card only. */
  reflectionOpen: (chunk: string) => string
  /** Closing takeaway line (spoken as-is). */
  conclusion: (line: string) => string
  /** Question + invitation-to-pray, narrated together on one card. */
  questions: (question: string, prayer: string) => string
  /**
   * Spoken on the STEP cards — the stepper screen that names each stage before
   * it begins (READ / WATCH / REFLECT / PRAY).
   *
   * These are the SAME phrases the host cards used to carry inline. They had to
   * become their own segments: the owner wants the step's light to travel and
   * land BEFORE the voice names it, and a phrase glued to the end of the
   * scripture segment ("Let's watch.") leaves no room to play anything before
   * it. Splitting them is what buys that beat.
   */
  steps: {
    /**
     * The stepper's OPENING line, spoken over the four stages with none of
     * them lit yet — the settle line's job, moved onto the screen that shows
     * the viewer what the next three minutes hold. Returned WITHOUT terminal
     * punctuation: it is shown on screen as well as spoken.
     */
    intro: () => string
    /** `ref` only when the citation is NOT spoken on the scripture card
     *  (steps off). With steps on this is called with no argument. */
    read: (ref?: string) => string
    watch: () => string
    /** Spoken first on the YouTube `opening` (owner, 2026-09-26). */
    welcome: () => string
    reflect: () => string
    /** The REFLECT lead-in when the clip has ALREADY played (clip-first
     *  structure): an invitation, not an instruction. */
    reflectAfterClip: () => string
    pray: () => string
  }
}

export type DevotionalLocale = {
  /** The words under the Jesus Film mark in the montage opening; English
   *  ("IN THIS DEVOTIONAL") when absent. */
  introKicker?: string
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
  /** The three-step column of the clip-first structure (WATCH / REFLECT /
   *  PRAY), upper-cased as shown. Defaults to English. */
  stepLabels?: readonly [string, string, string]
  /** Leave the translation's name off the verse address ("LUKE 8:16 · BSB").
   *  Russian viewers know the Synodal text; the owner found the tag
   *  redundant there (2026-10-06). */
  hideTranslationTag?: boolean
  /** The real target-language Bible a localized edition quotes from (never
   *  machine-translated). English quotes its own corpus and leaves this out. */
  scripture?: {
    fetch: (ref: string) => Promise<{ text: string; reference: string }>
    translation: string
  }
  /** Tidy a film subtitle cue from the dub's track before it goes on screen. */
  normalizeCaption?: (text: string) => string
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
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]
const EN_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

/**
 * Spoken after the hook on the cover: the line that asks the viewer to settle.
 *
 * Owner-chosen, and rotated by `sequence` so a daily series does not open the
 * same way every time — the same reason the hook FORMS rotate. All three are
 * first-person plural on purpose: "let's" invites, where an imperative would
 * order a stranger about thirty seconds into a video.
 */
const EN_SETTLE_LINES = [
  "Let's slow down and give Scripture our attention.",
  "Let's take a moment and sit with today's passage.",
  "Let's slow down together before the day takes over.",
] as const

/**
 * The settle line this sequence's cover actually SPEAKS.
 *
 * Exported because the manifest needs the exact wording to put it on screen
 * under the hook — the composition cannot re-derive it, and hardcoding one of
 * the three would show a line the voice never said on two runs out of three.
 */
export function settleLineFor(
  sequence: number,
  override?: string | null,
): string {
  if (override) return override
  const n = EN_SETTLE_LINES.length
  return EN_SETTLE_LINES[((Math.trunc(sequence) % n) + n) % n]
}

const EN_ASK_LEAD = "First, ask yourself:"
const EN_PRAY_LEAD = "Talk to God about it:"

export const EN_LOCALE: DevotionalLocale = {
  lang: "en",
  filmLanguageId: 529,
  voice: "rotate",
  stripDashes: true,
  // The closing card, in the owner's words (2026-09-29): "Let's bring this
  // to God." on the PRAY step, then "First, ask yourself:" the question, and
  // "Talk to God about it:" the prayer. Each label is the lead-in the viewer
  // hears, so the screen and the voice say the same thing.
  labels: {
    reflect: "Reflect",
    askYourself: "First, ask yourself",
    pray: "Talk to God about it",
    askLead: EN_ASK_LEAD,
    prayLead: EN_PRAY_LEAD,
  },
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
    cover: (hook, sequence, _date, occasion, settleOverride, omitSettle) => {
      const occasionLine = occasion ? ` Today is also ${occasion}.` : ""
      // HOOK FIRST, then the settle line. The hook is what stops the scroll, so
      // it cannot wait behind a date; the settle line is what turns a stopped
      // scroller into someone willing to sit still, so it comes second.
      //
      // The date is deliberately not spoken. A weekday and a number date the
      // video the moment it is heard, which is wrong for a series meant to be
      // watched whenever someone finds it. `_date` stays in the signature
      // because Russian still opens with it.
      // `hook` already arrives with terminal punctuation from the caller.
      if (omitSettle) return `${hook}${occasionLine}`
      const settle =
        settleOverride ?? EN_SETTLE_LINES[sequence % EN_SETTLE_LINES.length]
      return `${hook}${occasionLine} ${settle}`
    },
    // Deliberately does NOT say "scripture" or "passage": the settle line on the
    // cover, spoken seconds earlier, already uses one of those words, and the
    // repetition lands hard when the two are heard back to back.
    // The lead-ins now live on the step cards (see `steps` below), so the
    // scripture segment is the verse and nothing else.
    // The citation is spoken HERE, at the head of the verse, not on the step
    // card. Owner: the READ step should light up for "Here's where we're
    // reading today." and hand over to the scripture card the moment the voice
    // starts naming chapter and verse.
    scripture: (ref, verse) => (ref ? `${ref}. ${verse}` : verse),
    reflectionOpen: (chunk) => chunk,
    conclusion: (line) => line,
    questions: (question, prayer) =>
      [
        question && `${EN_ASK_LEAD} ${question}`,
        prayer && `${EN_PRAY_LEAD} ${prayer}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    steps: {
      // Owner's wording, and deliberately short: it is read over the four
      // stages while none of them is lit, and the READ step follows it
      // immediately.
      intro: () => `Let’s pause and let Scripture speak`,
      read: (ref) =>
        `Here's where we're reading today.${ref ? ` ${ref}.` : ""}`,
      watch: () => `Let's watch.`,
      welcome: () => `Welcome to Daily Bible Pause.`,
      reflect: () => `Reflect on this.`,
      // Owner's wording for the clip-first cut, where this is the first thing
      // the voice says after the film: it invites rather than instructs.
      // Replaced "Let's reflect on what this means for us." (owner,
      // 2026-09-29): the reflection reads the story closely before it
      // applies it, and the line now says so.
      reflectAfterClip: () =>
        `Let's look more closely at what this story means.`,
      // Owner's pick over "Here's something to sit with." — that opener said
      // nothing about prayer, while the card it introduces ends in one.
      pray: () => `Let's bring this to God.`,
    },
  },
}

// ---- Russian ----------------------------------------------------------------
// FIRST-DRAFT wording — owner (native speaker) to review/tweak. Months are in
// the GENITIVE case ("16 июля" = "the 16th of July"). No dash-stripping (тире is
// correct Russian punctuation, not an AI tell).

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]
// Capitalized: each use is sentence-initial (spoken cover) or a standalone
// label (on-screen date), where Russian weekday names take a capital.
const RU_WEEKDAYS = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
]

// Owner-reviewed on Bartimaeus (2026-10-06): the address is "ты" throughout,
// including the connectors ("Давай посмотрим", not "Давайте").
const RU_ASK_LEAD = "Сначала спроси себя:"
const RU_PRAY_LEAD = "Поговори об этом с Богом:"

export const RU_LOCALE: DevotionalLocale = {
  lang: "ru",
  filmLanguageId: 3934,
  voice: "russian",
  stripDashes: false,
  labels: {
    reflect: "Подумай",
    askYourself: "Сначала спроси себя",
    pray: "Поговори об этом с Богом",
    askLead: RU_ASK_LEAD,
    prayLead: RU_PRAY_LEAD,
  },
  // Verbs in the familiar form, like WATCH / REFLECT / PRAY (owner,
  // 2026-10-06: «посмотри» reads more naturally than «смотри»).
  stepLabels: ["ПОСМОТРИ", "ПОДУМАЙ", "ПОМОЛИСЬ"],
  hideTranslationTag: true,
  // No kicker under the Jesus Film mark in Russian (owner, 2026-10-07); the
  // spoken preview says «В этом видео…» itself.
  introKicker: "",
  scripture: { fetch: fetchSynodalPassage, translation: "Синодальный перевод" },
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
    // Bartimaeus RU (2026-10-06/07): the name is Лука́ (the voice said
    // Лу́ка), and the verb сто́ит (it said стои́т).
    ["Лука ", "Лука́ "],
    ["Лука,", "Лука́,"],
    ["Лука.", "Лука́."],
    ["стоит идти", "сто́ит идти"],
    // Martha and Mary RU (2026-10-08): "houses", not "at home".
    ["Дома переходят", "Дома́ переходят"],
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
    // Russian still opens with the date — the English change (hook first, no
    // date) was made for the English series and has not been reviewed by a
    // native speaker for Russian, so this half is deliberately left alone.
    cover: (hook, _sequence, date, occasion, _settleOverride, omitSettle) => {
      const occasionLine = occasion ? `Сегодня отмечается ${occasion}.\n\n` : ""
      if (omitSettle) {
        return date
          ? `Сегодня ${date}.\n\n${occasionLine}${hook}`
          : `${occasionLine}${hook}`
      }
      return date
        ? `Сегодня ${date}.\n\n${occasionLine}Сделай небольшую паузу. Давай поразмышляем над Божьим Словом.\n\n${hook}`
        : `Давай поразмышляем над Божьим Словом.\n\n${hook}`
    },
    // Lead-ins moved to the step cards, same as English; the citation opens
    // the verse (see the English note).
    scripture: (ref, verse) => (ref ? `${ref}. ${verse}` : verse),
    reflectionOpen: (chunk) => chunk,
    conclusion: (line) => line,
    questions: (question, prayer) =>
      [
        question && `${RU_ASK_LEAD} ${question}`,
        prayer && `${RU_PRAY_LEAD} ${prayer}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    // watch / reflectAfterClip / pray reviewed by the owner on Bartimaeus
    // (2026-10-06); the rest is still first-draft wording.
    steps: {
      intro: () => `Давай остановимся и послушаем Писание`,
      read: (ref) => `Вот отрывок из Писания.${ref ? ` ${ref}.` : ""}`,
      watch: () => `Давай посмотрим.`,
      welcome: () => `Добро пожаловать в Daily Bible Pause.`,
      reflect: () => `Подумай над этим.`,
      // Owner, 2026-10-08 (Martha): plainer than "что значит эта история".
      reflectAfterClip: () => `Давай подумаем над этой историей.`,
      pray: () => `Давай принесём это Богу.`,
    },
  },
}

const ES_MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
]
const ES_WEEKDAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
]

/**
 * The Latin American dub's subtitle track (Arclight) carries typing debris:
 * doubled spaces, the pre-1959 accent on "ó", a space before punctuation and
 * a lowercase word after a full stop. Cosmetic only; the wording is kept.
 */
export function normalizeEsCaption(text: string): string {
  return modernizeValeraOrthography(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(
      /([.!?])\s+([a-záéíóúñ])/g,
      (_m, p, ch) => `${p} ${ch.toUpperCase()}`,
    )
    .trim()
}

const ES_ASK_LEAD = "Primero, pregúntate:"
const ES_PRAY_LEAD = "Habla con Dios de esto:"

/**
 * Spanish (Latin American): neutral vocabulary, "tú" address, no "vosotros".
 * The film is the Latin American dub (Arclight 21028); scripture is the
 * Reina-Valera 1909 (public domain), the text Spanish-speaking evangelicals
 * know best. FIRST-DRAFT wording, owner is not a Spanish speaker: a native
 * reader should look over the connectors before a Spanish cut ships widely.
 */
export const ES_LOCALE: DevotionalLocale = {
  lang: "es",
  introKicker: "EN ESTE DEVOCIONAL",
  filmLanguageId: 21028,
  voice: "spanish",
  stripDashes: true,
  // Mirrors the English closing card (owner, 2026-09-29): the label is the
  // lead-in the viewer hears, so screen and voice say the same thing.
  labels: {
    reflect: "Reflexiona",
    askYourself: "Primero, pregúntate",
    pray: "Habla con Dios de esto",
    askLead: ES_ASK_LEAD,
    prayLead: ES_PRAY_LEAD,
  },
  stepLabels: ["VER", "REFLEXIONAR", "ORAR"],
  scripture: { fetch: fetchValeraPassage, translation: "Reina-Valera 1909" },
  attributionPrefix: "Adaptado de un clásico de confianza",
  spokenDate(iso) {
    const p = parseIso(iso)
    if (!p) return null
    return `${ES_WEEKDAYS[weekdayIndex(p)]}, ${p.d} de ${ES_MONTHS[p.m - 1]}`
  },
  coverDate(iso) {
    const p = parseIso(iso)
    if (!p) return null
    return `${ES_WEEKDAYS[weekdayIndex(p)]} · ${p.d} de ${ES_MONTHS[p.m - 1]}`
  },
  spokenReference: esSpokenReference,
  normalizeCaption: normalizeEsCaption,
  connectors: {
    cover: (hook, _sequence, date, occasion, _settleOverride, omitSettle) => {
      const occasionLine = occasion ? ` Hoy también es ${occasion}.` : ""
      if (omitSettle) return `${hook}${occasionLine}`
      return date
        ? `Hoy es ${date}.${occasionLine} Hagamos una pausa y dejemos que la Escritura nos hable.\n\n${hook}`
        : `${hook}${occasionLine} Hagamos una pausa y dejemos que la Escritura nos hable.`
    },
    scripture: (ref, verse) => (ref ? `${ref}. ${verse}` : verse),
    reflectionOpen: (chunk) => chunk,
    conclusion: (line) => line,
    questions: (question, prayer) =>
      [
        question && `${ES_ASK_LEAD} ${question}`,
        prayer && `${ES_PRAY_LEAD} ${prayer}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    steps: {
      intro: () => `Hagamos una pausa y escuchemos la Escritura`,
      read: (ref) => `Hoy leemos aquí.${ref ? ` ${ref}.` : ""}`,
      watch: () => `Veamos.`,
      welcome: () => `Bienvenidos a Daily Bible Pause.`,
      reflect: () => `Reflexiona sobre esto.`,
      // The English cut's wording ("Let's look more closely at what this
      // story means"), 2026-09-30.
      reflectAfterClip: () =>
        `Miremos más de cerca lo que significa esta historia.`,
      pray: () => `Llevemos esto a Dios.`,
    },
  },
}

export const LOCALES: Record<DevotionalLang, DevotionalLocale> = {
  en: EN_LOCALE,
  ru: RU_LOCALE,
  es: ES_LOCALE,
}

export function localeFor(lang: DevotionalLang): DevotionalLocale {
  return LOCALES[lang] ?? EN_LOCALE
}
