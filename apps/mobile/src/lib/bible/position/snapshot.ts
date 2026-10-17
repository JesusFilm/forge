// The saved reading position (feat-553 KTD5, R4), in the lastWatched snapshot
// pattern: a version gate, a shape check, and bad data read as absent. Pure
// parse and serialize; the store owns the storage calls.
import { isUsfmBookId } from "../text/books"
import { mappedLastVerse, type VerseRef } from "../versification/convert"

export const READING_POSITION_STORAGE_KEY = "bible-reader-position"

/** Increase this when the stored shape changes, so old records read as absent. */
export const READING_POSITION_VERSION = 1

/** R3, KD18: with no saved position, the reader opens here (BSB numbering). */
export const DEFAULT_READING_REF: VerseRef = Object.freeze({
  book: "JHN",
  chapter: 3,
  verse: 16,
})

/** A catalog id is at most 11 characters today; the cap only stops junk. */
const MAX_TRANSLATION_ID_LENGTH = 64
const SAFE_TRANSLATION_ID = /^[A-Za-z0-9_-]+$/

export type StoredReadingPosition = {
  /** BSB numbering (R38). Null until the viewer moves or a quote opens. */
  ref: VerseRef | null
  /** The viewer's explicit pick (R41). Null follows the default rules. */
  translationId: string | null
}

/** True for a verse that exists in BSB's own numbering. */
export function isBsbVerseRef(value: unknown): value is VerseRef {
  if (typeof value !== "object" || value === null) return false
  const { book, chapter, verse } = value as Record<string, unknown>
  if (typeof book !== "string" || !isUsfmBookId(book)) return false
  if (typeof chapter !== "number" || !Number.isInteger(chapter)) return false
  if (typeof verse !== "number" || !Number.isInteger(verse) || verse < 1) {
    return false
  }
  const last = mappedLastVerse("bsb", book, chapter)
  return last !== undefined && verse <= last
}

/** The id also names files in U4's storage, so only plain characters pass. */
export function isStorableTranslationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_TRANSLATION_ID_LENGTH &&
    SAFE_TRANSLATION_ID.test(value)
  )
}

/** Null for no record: unwritten, bad JSON, or another version. */
export function parseStoredReadingPosition(
  raw: string | null,
): StoredReadingPosition | null {
  if (raw == null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null
  }
  const record = data as Record<string, unknown>
  if (record.version !== READING_POSITION_VERSION) return null
  // Each half reads alone: a bad reference must not lose a good pick.
  return {
    ref: isBsbVerseRef(record.ref)
      ? {
          book: record.ref.book,
          chapter: record.ref.chapter,
          verse: record.ref.verse,
        }
      : null,
    translationId: isStorableTranslationId(record.translationId)
      ? record.translationId
      : null,
  }
}

export function serializeReadingPosition(
  position: StoredReadingPosition,
): string {
  return JSON.stringify({
    version: READING_POSITION_VERSION,
    ref: position.ref,
    translationId: position.translationId,
  })
}
