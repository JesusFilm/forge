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
