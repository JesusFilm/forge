/**
 * Deterministic Russian typography fixes for TRANSLATED copy (never scripture —
 * the Synodal text is authoritative and left untouched).
 *
 * The translator/editor LLM tends to emit the English-glued em dash
 * ("слово—слово"). In Russian the em dash (тире) is standard but takes spaces
 * around it (" — "). Fixing this in code is reliable; the LLM is not.
 */

/**
 * Remove the em/en dash from Russian copy (owner: тире reads heavy, don't want
 * it). Replace with a comma, then tidy doubled/misplaced punctuation. Applied to
 * copy only — never scripture.
 */
export function normalizeRuDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ", ")
    .replace(/([.!?;:])\s*,\s*/g, "$1 ")
    .replace(/\s+,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

/**
 * Russian renderings of the reflection authors in the corpus, so the cover
 * attribution reads in Russian ("Мэтью Генри", not "Matthew Henry"). Matched
 * case-insensitively on the trimmed English name; unknown names pass through
 * unchanged (better than a wrong transliteration).
 */
const RU_AUTHOR_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^matthew henry$/i, "Мэтью Генри"],
  [/^charles (h\.? )?spurgeon$/i, "Чарльз Сперджен"],
  [/^c\.?\s*h\.? spurgeon$/i, "Чарльз Сперджен"],
  [/^spurgeon$/i, "Сперджен"],
  [/^j\.?\s*c\.? ryle$/i, "Дж. Ч. Райл"],
  [/^john charles ryle$/i, "Дж. Ч. Райл"],
  [/^ryle$/i, "Райл"],
]

export function ruAuthorName(name: string): string {
  const n = name.trim()
  for (const [re, ru] of RU_AUTHOR_NAMES) if (re.test(n)) return ru
  return n
}
