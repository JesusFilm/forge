/**
 * U8 — Bible citation reference formatter.
 *
 * Strapi's `BibleCitation` content type provides four numeric range fields
 * (`chapterStart`, `chapterEnd`, `verseStart`, `verseEnd`) joined to a
 * `bibleBook` relation whose `name` is a plain `String`. The shape of the
 * range determines how the human-readable reference is rendered. The four
 * branches below cover every observed combination — including the live
 * `Galatians 2:20` sample where both `chapterEnd` and `verseEnd` are `null`.
 *
 * Branch matrix:
 * | # | chapterEnd | verseEnd | Output                          | Example             |
 * |---|------------|----------|---------------------------------|---------------------|
 * | 1 | null       | null     | `{book} {cs}:{vs}`              | "Galatians 2:20"    |
 * | 2 | null OR    | non-null | `{book} {cs}:{vs}-{ve}`         | "Galatians 2:20-25" |
 * |   | == cs      |          | (hyphen-minus, same chapter)    |                     |
 * | 3 | != cs      | non-null | `{book} {cs}:{vs}–{ce}:{ve}` | "Galatians 2:20–3:5"|
 * |   |            |          | (en-dash, cross-chapter)        |                     |
 * | 4 | != cs      | null     | `{book} {cs}:{vs}–{ce}`    | "Galatians 2:20–3"  |
 * |   |            |          | (en-dash, "through end of ch")  |                     |
 *
 * Fallback: If `bibleBook` is null or `bibleBook.name` is null/undefined we
 * substitute "Unknown Book" rather than throwing — citations can be saved in
 * Strapi without the relation in the unlikely case of editor error, and the
 * watch page must never crash on a missing book name.
 *
 * Note: en-dash (U+2013, `–`) is used for cross-chapter ranges per the plan
 * (R12 examples: "Galatians 2:20–3:5"). Same-chapter verse ranges use the
 * regular ASCII hyphen-minus (`-`) for consistency with conventional citation
 * style ("Galatians 2:20-25").
 */

const EN_DASH = "–"

type BibleBookLike = {
  name?: string | null
} | null

export type BibleCitationLike = {
  chapterStart: number | null
  chapterEnd?: number | null
  verseStart: number | null
  verseEnd?: number | null
  bibleBook?: BibleBookLike
}

export function formatCitation(citation: BibleCitationLike): string {
  // Strapi marks `chapterStart`/`verseStart` as nullable; in practice the
  // editor UI requires both, but we degrade gracefully (display "?") rather
  // than throwing if a malformed citation reaches the renderer.
  const chapterStart = citation.chapterStart ?? 0
  const verseStart = citation.verseStart ?? 0
  const { chapterEnd, verseEnd, bibleBook } = citation
  const bookName =
    bibleBook && bibleBook.name != null && bibleBook.name.length > 0
      ? bibleBook.name
      : "Unknown Book"

  // Branch 1 — Single verse: "Galatians 2:20"
  if (chapterEnd == null && verseEnd == null) {
    return `${bookName} ${chapterStart}:${verseStart}`
  }

  // Branch 2 — Same-chapter verse range (chapterEnd null OR equal to start),
  // with a defined verseEnd: "Galatians 2:20-25"
  if (verseEnd != null && (chapterEnd == null || chapterEnd === chapterStart)) {
    return `${bookName} ${chapterStart}:${verseStart}-${verseEnd}`
  }

  // Branch 3 — Cross-chapter range with explicit ending verse:
  // "Galatians 2:20–3:5"
  if (chapterEnd != null && chapterEnd !== chapterStart && verseEnd != null) {
    return `${bookName} ${chapterStart}:${verseStart}${EN_DASH}${chapterEnd}:${verseEnd}`
  }

  // Branch 4 — Cross-chapter range, "through end of chapter" (verseEnd null):
  // "Galatians 2:20–3"
  if (chapterEnd != null && chapterEnd !== chapterStart && verseEnd == null) {
    return `${bookName} ${chapterStart}:${verseStart}${EN_DASH}${chapterEnd}`
  }

  // Defensive fallback — covers any combination not explicitly handled above
  // (e.g. chapterEnd === chapterStart with verseEnd null, which should have
  // been normalized to branch 1 upstream but we degrade gracefully here).
  return `${bookName} ${chapterStart}:${verseStart}`
}
