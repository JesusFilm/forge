/**
 * U8 — Bible citation reference formatter.
 *
 * Strapi's `BibleCitation` content type provides four numeric range fields
 * (`chapterStart`, `chapterEnd`, `verseStart`, `verseEnd`) joined to a
 * `bibleBook` relation whose `name` is a plain `String`. The shape of the
 * range determines how the human-readable reference is rendered.
 *
 * Branch matrix:
 * | # | chapterEnd | verseStart | verseEnd | Output                        | Example             |
 * |---|------------|------------|----------|-------------------------------|---------------------|
 * | 1 | null       | non-null   | null     | `{book} {cs}:{vs}`            | "Galatians 2:20"    |
 * | 2 | null OR    | non-null   | non-null | `{book} {cs}:{vs}-{ve}`       | "Galatians 2:20-25" |
 * |   | == cs      |            |          | (hyphen-minus, same chapter)  |                     |
 * | 3 | != cs      | non-null   | non-null | `{book} {cs}:{vs}–{ce}:{ve}` | "Galatians 2:20–3:5"|
 * |   |            |            |          | (en-dash, cross-chapter)      |                     |
 * | 4 | != cs      | non-null   | null     | `{book} {cs}:{vs}–{ce}`      | "Galatians 2:20–3"  |
 * |   |            |            |          | (en-dash, through end of ch)  |                     |
 * | 5 | null OR    | null       | (any)    | `{book} {cs}`                 | "Genesis 3"         |
 * |   | == cs      |            |          | (whole-chapter citation)      |                     |
 * | 6 | != cs      | null       | (any)    | `{book} {cs}–{ce}`           | "Genesis 3–5"      |
 * |   |            |            |          | (chapter range, en-dash)      |                     |
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
  const { chapterStart, chapterEnd, verseStart, verseEnd, bibleBook } = citation
  const bookName =
    bibleBook && bibleBook.name != null && bibleBook.name.length > 0
      ? bibleBook.name
      : "Unknown Book"

  // Defensive: editor UI requires `chapterStart`. If it's missing the
  // citation is malformed — render just the book name rather than
  // "Book 0:0".
  if (chapterStart == null) {
    return bookName
  }

  // Branches 5–6 — Whole-chapter citations. Editor left `verseStart` blank
  // to point at an entire chapter ("Genesis 3") or chapter range
  // ("Genesis 3–5"). Must run before the verse-bearing branches so we
  // never emit "Genesis 3:0".
  if (verseStart == null) {
    if (chapterEnd != null && chapterEnd !== chapterStart) {
      return `${bookName} ${chapterStart}${EN_DASH}${chapterEnd}`
    }
    return `${bookName} ${chapterStart}`
  }

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
