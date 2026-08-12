/**
 * Deterministic Russian number spelling for the NARRATION (spoken text only).
 *
 * TTS reads bare digits unreliably in Russian ("17 июля" → the cardinal
 * "семнадцать" instead of the ordinal "семнадцатое"; "19:10" like a phone
 * number). Spelling the words in code — not via an LLM — makes it correct every
 * time. Ranges are small and bounded (dates 1–31, Bible chapters/verses ≤ ~176).
 */

const UNITS = [
  "",
  "один",
  "два",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
]
const TEENS = [
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
]
const TENS = [
  "",
  "",
  "двадцать",
  "тридцать",
  "сорок",
  "пятьдесят",
  "шестьдесят",
  "семьдесят",
  "восемьдесят",
  "девяносто",
]

/** Cardinal 1–199 (e.g. Bible chapter/verse): 19 → "девятнадцать". */
export function ruCardinal(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n > 199) return String(n)
  if (n < 10) return UNITS[n]
  if (n < 20) return TEENS[n - 10]
  if (n < 100) {
    const u = n % 10
    return u ? `${TENS[Math.floor(n / 10)]} ${UNITS[u]}` : TENS[Math.floor(n / 10)]
  }
  const rest = n - 100
  return rest ? `сто ${ruCardinal(rest)}` : "сто"
}

// Neuter ordinal (agrees with the implied «число»): 17 → "семнадцатое".
const ORDINAL_DAYS = [
  "",
  "первое",
  "второе",
  "третье",
  "четвёртое",
  "пятое",
  "шестое",
  "седьмое",
  "восьмое",
  "девятое",
  "десятое",
  "одиннадцатое",
  "двенадцатое",
  "тринадцатое",
  "четырнадцатое",
  "пятнадцатое",
  "шестнадцатое",
  "семнадцатое",
  "восемнадцатое",
  "девятнадцатое",
  "двадцатое",
  "двадцать первое",
  "двадцать второе",
  "двадцать третье",
  "двадцать четвёртое",
  "двадцать пятое",
  "двадцать шестое",
  "двадцать седьмое",
  "двадцать восьмое",
  "двадцать девятое",
  "тридцатое",
  "тридцать первое",
]

/** Ordinal day-of-month 1–31 (e.g. a date): 17 → "семнадцатое". */
export function ruOrdinalDay(n: number): string {
  return ORDINAL_DAYS[n] ?? String(n)
}

/**
 * Spell a Russian scripture citation for speech: "От Луки 19:10" →
 * "От Луки, глава девятнадцать, стих десять" (range → "стихи …–…"). Returns the
 * input unchanged if it doesn't parse.
 */
export function ruSpokenReference(reference: string): string {
  const m = reference.trim().match(/^(.*?)[\s,]*(\d+):(\d+)(?:-(\d+))?$/)
  if (!m) return reference
  const book = m[1].trim()
  const chapter = ruCardinal(Number(m[2]))
  const verses = m[4]
    ? `стихи ${ruCardinal(Number(m[3]))}–${ruCardinal(Number(m[4]))}`
    : `стих ${ruCardinal(Number(m[3]))}`
  return `${book}, глава ${chapter}, ${verses}`
}
