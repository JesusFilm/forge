/**
 * Owner-curated stress fixes for NARRATION (spoken text only, never displayed).
 *
 * TTS mis-stresses Russian heteronyms — "стоит" is read "сто́ит" (costs) where
 * the sentence means "стои́т" (stands). A combining acute accent (U+0301) on the
 * stressed vowel fixes it, and good Russian voices honour it. We apply these
 * deterministically from a locale list (not model-guessed, which proved
 * unreliable), so the fix is exact and grows one line at a time. The on-screen
 * card text keeps the clean original — accents live only in the voice track.
 *
 * (Numbers are spelled deterministically upstream; see ru-numbers.ts.)
 */

export function applyStressOverrides(
  text: string,
  overrides: ReadonlyArray<readonly [string, string]>,
): string {
  let out = text
  for (const [find, replace] of overrides) out = out.split(find).join(replace)
  return out
}

/**
 * Russian words whose stress changes their meaning (дома/дома́, сто́ит/стои́т,
 * за́мок/замо́к…). The voice picks one reading on its own and is wrong often
 * enough to be heard: "Дома переходят в чужие руки" came out as до́ма (at
 * home) on Martha and Mary (2026-10-08). A homograph left without an acute
 * after the overrides is reported, so a person decides before the voice does.
 */
export const RU_HOMOGRAPHS = [
  "дома",
  "стоит",
  "замок",
  "замки",
  "мука",
  "атлас",
  "орган",
  "органы",
  "белки",
  "кружки",
  "хлопок",
  "плачу",
  "парить",
  "сорока",
  "кругом",
  "броню",
  "простите",
] as const

export function ruUnmarkedHomographs(spoken: string): string[] {
  const out = new Set<string>()
  // A word is Cyrillic letters with any combining acute between them.
  for (const raw of spoken.match(/[А-Яа-яЁё]+(?:\u0301[А-Яа-яЁё]*)*/g) ?? []) {
    if (raw.includes("\u0301")) continue
    const w = raw.toLowerCase()
    if ((RU_HOMOGRAPHS as readonly string[]).includes(w)) out.add(w)
  }
  return [...out]
}
