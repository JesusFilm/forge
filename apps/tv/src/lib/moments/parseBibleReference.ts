// Chunk `bibleVerses` are free-form reference STRINGS ("Matthew 5:3-12",
// "1 Corinthians 13") from the enrichment pipeline — unlike `bibleCitations`,
// which arrive pre-parsed. This turns them into the `WatchBibleCitation`
// shape `useBibleVerses` already fetches text for, so the moments panel rides
// the existing verse fetcher and its module-scope cache instead of growing a
// second one.
//
// Conservative on purpose: enrichment output is LLM-derived, so anything that
// does not match the book-chapter[-verse[-range]] shape returns null and the
// reference renders as plain text without fetched scripture. A wrong guess
// would fetch and display the WRONG passage under a right-looking reference —
// strictly worse than showing none.

import type { WatchBibleCitation } from "../normalizeVideo"

// "Matthew 5", "Matthew 5:3", "Matthew 5:3-12", "Song of Solomon 2:1",
// "1 Corinthians 13:4-8". Book = optional leading ordinal + word run;
// range end is verse-only (cross-chapter ranges like "5:3-6:2" are rare in
// enrichment output and deliberately rejected rather than half-parsed).
const REFERENCE_PATTERN =
  /^\s*([1-3]?\s?[A-Za-z][A-Za-z .'’-]*?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?\s*$/

/**
 * Parse one reference string, or null when it does not safely parse.
 * `documentId` is synthesized from the normalized reference — stable across
 * renders, which is all `useBibleVerses` needs it for (cache keying).
 */
export function parseBibleReference(
  reference: string,
): WatchBibleCitation | null {
  const match = REFERENCE_PATTERN.exec(reference)
  if (match == null) return null
  const [, rawBook, rawChapter, rawVerseStart, rawVerseEnd] = match
  const bookName = rawBook!.replace(/\s+/g, " ").trim()
  const chapter = Number.parseInt(rawChapter!, 10)
  if (!Number.isFinite(chapter) || chapter < 1) return null

  const verseStart =
    rawVerseStart != null ? Number.parseInt(rawVerseStart, 10) : null
  const verseEnd = rawVerseEnd != null ? Number.parseInt(rawVerseEnd, 10) : null
  if (verseStart != null && verseStart < 1) return null
  if (verseEnd != null && (verseStart == null || verseEnd < verseStart)) {
    return null
  }

  return {
    documentId: `moment-ref:${bookName.toLowerCase()}:${chapter}:${verseStart ?? ""}:${verseEnd ?? ""}`,
    osisId: null,
    bookName,
    chapterStart: chapter,
    chapterEnd: null,
    verseStart,
    verseEnd,
    order: null,
  }
}

/** Parse a moment's reference list, dropping what does not parse. Capped so a
 *  runaway enrichment row cannot queue dozens of verse fetches. */
export const MAX_REFERENCES_PER_MOMENT = 4

export function parseBibleReferences(
  references: readonly string[],
): WatchBibleCitation[] {
  const parsed: WatchBibleCitation[] = []
  for (const reference of references) {
    const citation = parseBibleReference(reference)
    if (citation != null) parsed.push(citation)
    if (parsed.length >= MAX_REFERENCES_PER_MOMENT) break
  }
  return parsed
}
