// Fail-closed projection from bible.helloao.org JSON to the per-book text
// format (U1). Every source (bundled BSB, downloads, chapter fetches) goes
// through here, so the reader reads one shape.
import { bookByUsfm, bookOrder, isUsfmBookId, type UsfmBookId } from "./books"
import { isTextualOmission } from "./omissions"
import {
  BIBLE_TEXT_FORMAT_VERSION,
  type BookText,
  type Chapter,
  type ChapterText,
  type TextDirection,
  type TextHeader,
  type TextRejectReason,
  type TextRejection,
  type OmittedBook,
  type TextResult,
  type TranslationText,
  type Verse,
  type VerseLine,
} from "./types"

type UnknownRecord = Record<string, unknown>
type TranslationInfo = { translationId: string; textDirection: TextDirection }
type BookInfo = { bookId: UsfmBookId; bookName: string }
type LineDraft = { text: string; poem: number | undefined }

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

// The gap loops run once per missing number, so a huge verse number from the
// API or a stored file freezes the reader. PSA 119 has 176 verses, and the
// route parsers accept at most 3 digits.
const MAX_VERSE_NUMBER = 999

function isVerseNumber(value: unknown): value is number {
  return isPositiveInteger(value) && value <= MAX_VERSE_NUMBER
}

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function trimmedOrNull(value: unknown): string | null {
  return isFilledString(value) ? value.trim() : null
}

function isTextDirection(value: unknown): value is TextDirection {
  return value === "ltr" || value === "rtl"
}

function ok<T>(value: T): TextResult<T> {
  return { status: "ok", value }
}

function reject(
  reason: TextRejectReason,
  bookId?: string,
  chapterNumber?: number,
): TextRejection {
  return {
    status: "rejected",
    reason,
    ...(bookId === undefined ? {} : { bookId }),
    ...(chapterNumber === undefined ? {} : { chapterNumber }),
  }
}

// The API trims every segment, so the join must add the space back. These
// scripts write words with no space: Thai, Lao, Myanmar, Khmer, kana, Han.
const NO_SPACE_SCRIPT =
  /[\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/
const STARTS_WITH_CLOSING = /^[)\]}’”»›,.;:!?،؛؟۔।॥።፣፤]/
const ENDS_WITH_OPENING = /[([{‘“«‹¿¡]$/

function needsSpace(before: string, after: string): boolean {
  if (STARTS_WITH_CLOSING.test(after) || ENDS_WITH_OPENING.test(before)) {
    return false
  }
  const last = before.charAt(before.length - 1)
  const first = after.charAt(0)
  return !(NO_SPACE_SCRIPT.test(last) && NO_SPACE_SCRIPT.test(first))
}

/**
 * Turns one verse's `content` array into lines. The API's own `.simple.json`
 * join glues words ("him.”Selah", "him,“Most") and breaks poetry lines at
 * footnotes; eBible.org's printed text is the reference for these rules.
 */
function verseLines(content: readonly unknown[]): VerseLine[] {
  const drafts: LineDraft[] = []
  let line: LineDraft | undefined
  let lastWordsOfJesus = false
  let markerSinceText = false
  let breakSinceText = false
  let sawOrdinaryText = false

  for (const part of content) {
    let rawText: string
    let poem: number | undefined
    let wordsOfJesus = false
    let descriptive = false
    if (typeof part === "string") {
      rawText = part
    } else if (!isRecord(part)) {
      continue
    } else if (typeof part.text === "string") {
      rawText = part.text
      poem = isPositiveInteger(part.poem) ? part.poem : undefined
      wordsOfJesus = part.wordsOfJesus === true
      descriptive = part.descriptive === true
    } else if (part.lineBreak === true || typeof part.heading === "string") {
      breakSinceText = true
      continue
    } else {
      // A footnote reference, or a marker that this code does not know.
      markerSinceText = true
      continue
    }

    // Descriptive text after the verse's own text is the next stanza's label
    // (WEB Psalm 119 "BETH"). At the start it is verse text (BSB Zech 12:1).
    if (descriptive && sawOrdinaryText) {
      breakSinceText = true
      continue
    }
    const text = rawText.trim()
    if (text.length === 0) continue
    if (!descriptive) sawOrdinaryText = true

    // Same-level poetry without a marker between is a new paragraph (a line);
    // a footnote or a red-letter change inside one line does not break it.
    if (
      line !== undefined &&
      !breakSinceText &&
      poem === line.poem &&
      (poem === undefined ||
        markerSinceText ||
        wordsOfJesus !== lastWordsOfJesus)
    ) {
      line.text += needsSpace(line.text, text) ? ` ${text}` : text
    } else {
      line = { text, poem }
      drafts.push(line)
    }
    lastWordsOfJesus = wordsOfJesus
    markerSinceText = false
    breakSinceText = false
  }

  return drafts.map(({ text, poem }) =>
    poem === undefined ? { text } : { text, poem },
  )
}

/**
 * Normalizes one chapter object (`{ number, content, footnotes }`). It drops
 * headings, Psalm subtitles, a title numbered 0, footnotes, and unknown items.
 * Any other bad verse number, or a verse with no content, rejects the chapter.
 */
export function normalizeChapter(
  bookId: UsfmBookId,
  raw: unknown,
): TextResult<Chapter> {
  if (!isRecord(raw) || !Array.isArray(raw.content)) {
    return reject("malformed-chapter", bookId)
  }
  const chapterNumber = raw.number
  if (!isPositiveInteger(chapterNumber)) {
    return reject("invalid-chapter-number", bookId)
  }
  const content: readonly unknown[] = raw.content

  // Every verse marker, with or without text: an empty marker is a gap.
  const markers = new Map<number, VerseLine[]>()
  for (const item of content) {
    if (!isRecord(item) || item.type !== "verse") continue
    const verseNumber = item.number
    // Before verse 1, a verse 0 is a title. After a verse, it is a piece that
    // the source split off that verse (por_tft MAT 14:21), so it fails.
    if (verseNumber === 0 && markers.size === 0) continue
    if (!isVerseNumber(verseNumber) || !Array.isArray(item.content)) {
      return reject("invalid-verse", bookId, chapterNumber)
    }
    const lines = verseLines(item.content)
    const earlier = markers.get(verseNumber)
    if (earlier === undefined) {
      markers.set(verseNumber, lines)
    } else {
      earlier.push(...lines)
    }
  }

  const numbers = [...markers.keys()].sort((a, b) => a - b)
  const verses: Verse[] = []
  numbers.forEach((number, index) => {
    const lines = markers.get(number) ?? []
    if (lines.length === 0) return
    // A missing number after a verse is part of that verse's merged range,
    // unless the translation omits that verse on purpose (BSB MAT 18:11).
    const nextMarker = numbers[index + 1]
    let through = number
    while (
      nextMarker !== undefined &&
      through + 1 < nextMarker &&
      !isTextualOmission(bookId, chapterNumber, through + 1)
    ) {
      through += 1
    }
    verses.push(
      through > number ? { number, through, lines } : { number, lines },
    )
  })

  const lastVerse = numbers[numbers.length - 1]
  if (verses.length === 0 || lastVerse === undefined) {
    return reject("no-verses", bookId, chapterNumber)
  }
  return ok({ number: chapterNumber, lastVerse, verses })
}

function readTranslation(raw: unknown): TextResult<TranslationInfo> {
  if (!isRecord(raw)) return reject("invalid-translation")
  const translationId = trimmedOrNull(raw.id)
  if (translationId === null) return reject("invalid-translation")
  if (!isTextDirection(raw.textDirection)) {
    return reject("invalid-text-direction")
  }
  return ok({ translationId, textDirection: raw.textDirection })
}

function readBook(raw: UnknownRecord): TextResult<BookInfo> {
  const id = raw.id
  if (typeof id !== "string") return reject("malformed-book")
  if (!isUsfmBookId(id)) return reject("unknown-book", id)
  const bookName =
    trimmedOrNull(raw.commonName) ??
    trimmedOrNull(raw.name) ??
    trimmedOrNull(raw.title) ??
    bookByUsfm(id).name
  return ok({ bookId: id, bookName })
}

/** Normalizes a single chapter file: `/api/<translation>/<BOOK>/<n>.json`. */
export function normalizeChapterFile(raw: unknown): TextResult<ChapterText> {
  if (!isRecord(raw) || !isRecord(raw.book)) return reject("malformed-source")
  const translation = readTranslation(raw.translation)
  if (translation.status === "rejected") return translation
  const book = readBook(raw.book)
  if (book.status === "rejected") return book
  const chapter = normalizeChapter(book.value.bookId, raw.chapter)
  if (chapter.status === "rejected") return chapter
  return ok({
    formatVersion: BIBLE_TEXT_FORMAT_VERSION,
    ...translation.value,
    ...book.value,
    chapter: chapter.value,
  })
}

function buildBook(
  translation: TranslationInfo,
  raw: unknown,
): TextResult<BookText> {
  if (!isRecord(raw)) return reject("malformed-book")
  const book = readBook(raw)
  if (book.status === "rejected") return book
  const { bookId } = book.value
  if (!Array.isArray(raw.chapters)) return reject("malformed-book", bookId)
  const entries: readonly unknown[] = raw.chapters

  const chapters: Chapter[] = []
  const seen = new Set<number>()
  for (const entry of entries) {
    // complete.json wraps each chapter with its audio links.
    const chapter = normalizeChapter(
      bookId,
      isRecord(entry) ? entry.chapter : undefined,
    )
    if (chapter.status === "rejected") return chapter
    if (seen.has(chapter.value.number)) {
      return reject("duplicate-chapter", bookId, chapter.value.number)
    }
    seen.add(chapter.value.number)
    chapters.push(chapter.value)
  }
  if (chapters.length === 0) return reject("no-chapters", bookId)
  chapters.sort((a, b) => a.number - b.number)
  return ok({
    formatVersion: BIBLE_TEXT_FORMAT_VERSION,
    ...translation,
    ...book.value,
    chapters,
  })
}

/** Normalizes one `books[]` entry of a `complete.json` with its translation. */
export function normalizeBook(
  translation: unknown,
  book: unknown,
): TextResult<BookText> {
  const info = readTranslation(translation)
  if (info.status === "rejected") return info
  return buildBook(info.value, book)
}

/**
 * Normalizes a whole `complete.json` into one file per book. A defect costs
 * the book, not the translation: it omits and reports that book (KD4, R25).
 * It rejects a source whose shape is broken, or one where no book survives.
 */
export function normalizeTranslation(
  raw: unknown,
): TextResult<TranslationText> {
  if (!isRecord(raw) || !Array.isArray(raw.books)) {
    return reject("malformed-source")
  }
  const info = readTranslation(raw.translation)
  if (info.status === "rejected") return info
  const entries: readonly unknown[] = raw.books

  const books: BookText[] = []
  const skippedBookIds: string[] = []
  const omittedBooks: OmittedBook[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (isRecord(entry) && typeof entry.id === "string") {
      if (!isUsfmBookId(entry.id)) {
        skippedBookIds.push(entry.id)
        continue
      }
      if (seen.has(entry.id)) return reject("duplicate-book", entry.id)
      seen.add(entry.id)
    }
    const book = buildBook(info.value, entry)
    if (book.status === "ok") {
      books.push(book.value)
      continue
    }
    // An entry with no book id cannot be named, so the source is broken.
    const { bookId, reason, chapterNumber } = book
    if (bookId === undefined || !isUsfmBookId(bookId)) return book
    omittedBooks.push(
      chapterNumber === undefined
        ? { bookId, reason }
        : { bookId, reason, chapterNumber },
    )
  }
  if (books.length === 0) return reject("no-books")
  books.sort((a, b) => bookOrder(a.bookId) - bookOrder(b.bookId))
  omittedBooks.sort((a, b) => bookOrder(a.bookId) - bookOrder(b.bookId))
  return ok({ ...info.value, books, skippedBookIds, omittedBooks })
}

function parseHeader(raw: unknown): TextResult<TextHeader> {
  if (!isRecord(raw)) return reject("malformed-text")
  if (raw.formatVersion !== BIBLE_TEXT_FORMAT_VERSION) {
    return reject("format-version")
  }
  const { translationId, bookId, bookName, textDirection } = raw
  if (
    !isFilledString(translationId) ||
    typeof bookId !== "string" ||
    !isUsfmBookId(bookId) ||
    !isFilledString(bookName) ||
    !isTextDirection(textDirection)
  ) {
    return reject("malformed-text")
  }
  return ok({
    formatVersion: BIBLE_TEXT_FORMAT_VERSION,
    translationId,
    bookId,
    bookName,
    textDirection,
  })
}

function parseVerse(raw: unknown): Verse | null {
  if (!isRecord(raw)) return null
  const { number, through, lines } = raw
  if (!isPositiveInteger(number) || !Array.isArray(lines)) return null
  if (
    through !== undefined &&
    !(isPositiveInteger(through) && through > number)
  ) {
    return null
  }
  const storedLines: readonly unknown[] = lines
  const parsed: VerseLine[] = []
  for (const line of storedLines) {
    if (!isRecord(line) || !isFilledString(line.text)) return null
    if (line.poem === undefined) {
      parsed.push({ text: line.text })
    } else if (isPositiveInteger(line.poem)) {
      parsed.push({ text: line.text, poem: line.poem })
    } else {
      return null
    }
  }
  if (parsed.length === 0) return null
  return isPositiveInteger(through)
    ? { number, through, lines: parsed }
    : { number, lines: parsed }
}

function parseChapter(raw: unknown): Chapter | null {
  if (!isRecord(raw)) return null
  const { number, lastVerse, verses } = raw
  if (
    !isPositiveInteger(number) ||
    !isVerseNumber(lastVerse) ||
    !Array.isArray(verses)
  ) {
    return null
  }
  const storedVerses: readonly unknown[] = verses
  const parsed: Verse[] = []
  let covered = 0
  for (const stored of storedVerses) {
    const verse = parseVerse(stored)
    if (verse === null || verse.number <= covered) return null
    covered = verse.through ?? verse.number
    parsed.push(verse)
  }
  if (parsed.length === 0 || covered > lastVerse) return null
  return { number, lastVerse, verses: parsed }
}

/** Reads a stored per-book file back, refusing another format version. */
export function parseBookText(raw: unknown): TextResult<BookText> {
  const header = parseHeader(raw)
  if (header.status === "rejected") return header
  const stored = isRecord(raw) ? raw.chapters : undefined
  if (!Array.isArray(stored))
    return reject("malformed-text", header.value.bookId)
  const storedChapters: readonly unknown[] = stored

  const chapters: Chapter[] = []
  for (const entry of storedChapters) {
    const chapter = parseChapter(entry)
    const previous = chapters[chapters.length - 1]
    if (
      chapter === null ||
      (previous !== undefined && chapter.number <= previous.number)
    ) {
      return reject("malformed-text", header.value.bookId)
    }
    chapters.push(chapter)
  }
  if (chapters.length === 0)
    return reject("malformed-text", header.value.bookId)
  return ok({ ...header.value, chapters })
}

/** Reads a stored single chapter back, refusing another format version. */
export function parseChapterText(raw: unknown): TextResult<ChapterText> {
  const header = parseHeader(raw)
  if (header.status === "rejected") return header
  const chapter = parseChapter(isRecord(raw) ? raw.chapter : undefined)
  if (chapter === null) return reject("malformed-text", header.value.bookId)
  return ok({ ...header.value, chapter })
}
