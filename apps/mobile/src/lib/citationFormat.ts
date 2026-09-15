// SYNC with apps/web/src/lib/citation-format.ts. Same branch matrix, reading
// the already-localized `bookName` this app normalizes instead of web's raw
// `bibleBook` relation. A divergence shows up as two different labels for one
// citation across the two apps.
//
// The label is all the viewer gets on a card whose passage did not resolve, so
// every nullable combination must render without a dangling separator.

import type { WatchBibleCitation } from "./normalizeVideo"

const EN_DASH = "–"
const UNKNOWN_BOOK = "Unknown Book"

type CitationLabelInput = Pick<
  WatchBibleCitation,
  "bookName" | "chapterStart" | "chapterEnd" | "verseStart" | "verseEnd"
>

/**
 * Render a human-readable reference for a citation.
 *
 * | chapterEnd  | verseStart | verseEnd | Output              | Example             |
 * | ----------- | ---------- | -------- | ------------------- | ------------------- |
 * | null        | set        | null     | book cs:vs          | Galatians 2:20      |
 * | null or =cs | set        | set      | book cs:vs-ve       | Galatians 2:20-25   |
 * | !=cs        | set        | set      | book cs:vs–ce:ve    | Galatians 2:20–3:5  |
 * | !=cs        | set        | null     | book cs:vs–ce       | Galatians 2:20–3    |
 * | null or =cs | null       | any      | book cs             | Genesis 3           |
 * | !=cs        | null       | any      | book cs–ce          | Genesis 3–5         |
 */
export function formatCitationLabel(citation: CitationLabelInput): string {
  const { chapterStart, chapterEnd, verseStart, verseEnd } = citation
  const bookName =
    citation.bookName != null && citation.bookName.length > 0
      ? citation.bookName
      : UNKNOWN_BOOK

  // A citation with no chapter is malformed. Render the book alone rather than
  // "Genesis 0:0".
  if (chapterStart == null) return bookName

  const crossChapter = chapterEnd != null && chapterEnd !== chapterStart

  // Whole-chapter citations run FIRST, or a missing verse renders "Genesis 3:".
  if (verseStart == null) {
    return crossChapter
      ? `${bookName} ${chapterStart}${EN_DASH}${chapterEnd}`
      : `${bookName} ${chapterStart}`
  }

  if (crossChapter) {
    return verseEnd != null
      ? `${bookName} ${chapterStart}:${verseStart}${EN_DASH}${chapterEnd}:${verseEnd}`
      : `${bookName} ${chapterStart}:${verseStart}${EN_DASH}${chapterEnd}`
  }

  return verseEnd != null
    ? `${bookName} ${chapterStart}:${verseStart}-${verseEnd}`
    : `${bookName} ${chapterStart}:${verseStart}`
}
