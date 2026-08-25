/**
 * Make on-screen names agree between the film's captions and the devotional.
 *
 * Three texts share a screen and three sources spell the same person
 * differently: the WEB Bible verse says "Zacchaeus", Matthew Henry (1700s)
 * wrote "Zaccheus", and the JESUS film's own subtitles say "Zaccheus". The
 * modernizer already settles the reflection on the Bible's spelling, so once
 * captions were restored the viewer saw both forms within seconds of each
 * other.
 *
 * The Bible wins: it is the text quoted on screen, and it is the spelling a
 * viewer can look up. This rewrites the CAPTIONS only — never the verse, never
 * the reflection — and only between accepted spellings of one name, which is
 * not a change to what the film says.
 */

/** Canonical (WEB) spelling → the variants seen in film subtitles. */
const VARIANTS: ReadonlyArray<{ canonical: string; pattern: RegExp }> = [
  { canonical: "Zacchaeus", pattern: /\bZacch?eus\b/g },
]

export function normalizeCaptionNames(text: string): string {
  let out = text
  for (const { canonical, pattern } of VARIANTS) {
    out = out.replace(pattern, canonical)
  }
  return out
}
