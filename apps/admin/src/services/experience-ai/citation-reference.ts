/**
 * Shared scripture-reference helpers.
 *
 * `BibleBook.name` is a JSON map keyed by BCP-47 locale. These pure helpers
 * resolve a localized book name and compose a human-readable reference label
 * (e.g. "John 20:19-29") from a citation's structured chapter/verse range.
 *
 * They NEVER return verse text — reference-first scripture stores only the
 * reference + structured identity; the actual verse text is resolved at web
 * render from the YouVersion / jsdelivr pipeline.
 *
 * Lifted here (from `agent-tools.service.ts`) so both the bible-verse agent
 * tool and the video context pack consume one implementation.
 */

/** A localized name map keyed by BCP-47 locale (the `BibleBook.name` JSON shape). */
export function isNameMap(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Resolve a localized display name from a `BibleBook.name` map with BCP-47
 * fallback: exact locale → language base (`fr-CA` → `fr`) → `en` → fallback.
 */
export function pickLocalisedName(
  name: unknown,
  locale: string,
  fallback: string,
): string {
  if (!isNameMap(name)) return fallback
  if (typeof name[locale] === "string" && name[locale]) return name[locale]
  // Strip BCP-47 region tail and try the language base (e.g. "fr-CA" → "fr").
  const base = locale.split("-")[0]
  if (base && typeof name[base] === "string" && name[base]) return name[base]
  if (typeof name.en === "string" && name.en) return name.en
  return fallback
}

/** The structured citation range needed to compose a reference label. */
export type CitationReferenceParts = {
  chapterStart?: number | null
  chapterEnd?: number | null
  verseStart?: number | null
  verseEnd?: number | null
}

/**
 * Compose a localized scripture reference label from a `BibleBook.name` map and a
 * citation's chapter/verse range. Never returns verse text.
 *
 * Handles single verse ("John 3:16"), same-chapter verse range ("John 20:19-29"),
 * chapter-only ("Psalm 23"), chapter range ("Psalm 23-24"), and cross-chapter verse
 * range ("Matthew 5:1-7:29"), plus locale fallback for the book name.
 */
export function formatCitationReference(
  bookName: unknown,
  citation: CitationReferenceParts,
  locale: string,
  fallbackBook = "",
): string {
  const book = pickLocalisedName(bookName, locale, fallbackBook).trim()
  const chapterStart = citation.chapterStart ?? null
  const chapterEnd = citation.chapterEnd ?? null
  const verseStart = citation.verseStart ?? null
  const verseEnd = citation.verseEnd ?? null

  // No chapter at all → just the book name.
  if (chapterStart == null) return book

  // Chapter(s) only, no verse.
  if (verseStart == null) {
    if (chapterEnd != null && chapterEnd !== chapterStart) {
      return `${book} ${chapterStart}-${chapterEnd}`.trim()
    }
    return `${book} ${chapterStart}`.trim()
  }

  const start = `${chapterStart}:${verseStart}`
  const crossChapter = chapterEnd != null && chapterEnd !== chapterStart

  // Cross-chapter verse range, e.g. "Matthew 5:1-7:29".
  if (crossChapter) {
    const endVerse = verseEnd ?? verseStart
    return `${book} ${start}-${chapterEnd}:${endVerse}`.trim()
  }

  // Single verse.
  if (verseEnd == null || verseEnd === verseStart) {
    return `${book} ${start}`.trim()
  }

  // Same-chapter verse range, e.g. "John 20:19-29".
  return `${book} ${start}-${verseEnd}`.trim()
}
