type BibleBookLike = {
  name?: string | null
} | null

export type YouVersionCitationLike = {
  osisId?: string | null
  chapterStart: number | null
  chapterEnd?: number | null
  verseStart: number | null
  verseEnd?: number | null
  bibleBook?: BibleBookLike
} | null

const BOOKS = [
  ["Gen", "GEN", "Genesis"],
  ["Exod", "EXO", "Exodus"],
  ["Lev", "LEV", "Leviticus"],
  ["Num", "NUM", "Numbers"],
  ["Deut", "DEU", "Deuteronomy"],
  ["Josh", "JOS", "Joshua"],
  ["Judg", "JDG", "Judges"],
  ["Ruth", "RUT", "Ruth"],
  ["1Sam", "1SA", "1 Samuel"],
  ["2Sam", "2SA", "2 Samuel"],
  ["1Kgs", "1KI", "1 Kings"],
  ["2Kgs", "2KI", "2 Kings"],
  ["1Chr", "1CH", "1 Chronicles"],
  ["2Chr", "2CH", "2 Chronicles"],
  ["Ezra", "EZR", "Ezra"],
  ["Neh", "NEH", "Nehemiah"],
  ["Esth", "EST", "Esther"],
  ["Job", "JOB", "Job"],
  ["Ps", "PSA", "Psalms"],
  ["Prov", "PRO", "Proverbs"],
  ["Eccl", "ECC", "Ecclesiastes"],
  ["Song", "SNG", "Song of Songs"],
  ["Isa", "ISA", "Isaiah"],
  ["Jer", "JER", "Jeremiah"],
  ["Lam", "LAM", "Lamentations"],
  ["Ezek", "EZK", "Ezekiel"],
  ["Dan", "DAN", "Daniel"],
  ["Hos", "HOS", "Hosea"],
  ["Joel", "JOL", "Joel"],
  ["Amos", "AMO", "Amos"],
  ["Obad", "OBA", "Obadiah"],
  ["Jonah", "JON", "Jonah"],
  ["Mic", "MIC", "Micah"],
  ["Nah", "NAM", "Nahum"],
  ["Hab", "HAB", "Habakkuk"],
  ["Zeph", "ZEP", "Zephaniah"],
  ["Hag", "HAG", "Haggai"],
  ["Zech", "ZEC", "Zechariah"],
  ["Mal", "MAL", "Malachi"],
  ["Matt", "MAT", "Matthew"],
  ["Mark", "MRK", "Mark"],
  ["Luke", "LUK", "Luke"],
  ["John", "JHN", "John"],
  ["Acts", "ACT", "Acts"],
  ["Rom", "ROM", "Romans"],
  ["1Cor", "1CO", "1 Corinthians"],
  ["2Cor", "2CO", "2 Corinthians"],
  ["Gal", "GAL", "Galatians"],
  ["Eph", "EPH", "Ephesians"],
  ["Phil", "PHP", "Philippians"],
  ["Col", "COL", "Colossians"],
  ["1Thess", "1TH", "1 Thessalonians"],
  ["2Thess", "2TH", "2 Thessalonians"],
  ["1Tim", "1TI", "1 Timothy"],
  ["2Tim", "2TI", "2 Timothy"],
  ["Titus", "TIT", "Titus"],
  ["Phlm", "PHM", "Philemon"],
  ["Heb", "HEB", "Hebrews"],
  ["Jas", "JAS", "James"],
  ["1Pet", "1PE", "1 Peter"],
  ["2Pet", "2PE", "2 Peter"],
  ["1John", "1JN", "1 John"],
  ["2John", "2JN", "2 John"],
  ["3John", "3JN", "3 John"],
  ["Jude", "JUD", "Jude"],
  ["Rev", "REV", "Revelation"],
] as const

const OSIS_TO_USFM = Object.fromEntries(
  BOOKS.map(([osis, usfm]) => [osis, usfm]),
) as Record<string, string>

const BOOK_NAME_ENTRIES: Array<[string, string]> = []
for (const [, usfm, name] of BOOKS) {
  const normalized = normalizeBookName(name)
  BOOK_NAME_ENTRIES.push([normalized, usfm])
  if (name === "Psalms") {
    BOOK_NAME_ENTRIES.push(["psalm", usfm])
  }
}

const BOOK_NAME_TO_USFM = Object.fromEntries(BOOK_NAME_ENTRIES) as Record<
  string,
  string
>

BOOK_NAME_TO_USFM.songofsolomon = "SNG"

const OSIS_BOOK_PATTERN = /^[1-3]?[A-Za-z]+$/
const USFM_REFERENCE_PATTERN =
  /^[1-3]?[A-Z]{2,3}\.[1-9]\d*(?:\.[1-9]\d*(?:-[1-9]\d*)?)?$/

export function toYouVersionReference(
  citation: YouVersionCitationLike,
): string | null {
  if (citation == null || !isPositiveInteger(citation.chapterStart)) {
    return null
  }

  const bookCode = getBookCode(citation)
  if (bookCode == null) {
    return null
  }

  const { chapterStart, chapterEnd, verseStart, verseEnd } = citation

  if (verseStart == null) {
    if (verseEnd != null) return null
    if (chapterEnd != null && chapterEnd !== chapterStart) return null
    return safeReference(`${bookCode}.${chapterStart}`)
  }

  if (!isPositiveInteger(verseStart)) return null

  if (chapterEnd != null) {
    if (!isPositiveInteger(chapterEnd) || chapterEnd < chapterStart) {
      return null
    }
    if (chapterEnd > chapterStart) {
      if (verseEnd != null && !isPositiveInteger(verseEnd)) return null
      return safeReference(`${bookCode}.${chapterStart}.${verseStart}`)
    }
  }

  if (verseEnd == null)
    return safeReference(`${bookCode}.${chapterStart}.${verseStart}`)
  if (!isPositiveInteger(verseEnd) || verseEnd < verseStart) return null
  if (verseEnd === verseStart)
    return safeReference(`${bookCode}.${chapterStart}.${verseStart}`)

  return safeReference(`${bookCode}.${chapterStart}.${verseStart}-${verseEnd}`)
}

function getBookCode(citation: Exclude<YouVersionCitationLike, null>) {
  if (citation.osisId != null && citation.osisId.trim() !== "") {
    const osisBook = citation.osisId.split(".")[0]
    return osisBook != null &&
      OSIS_BOOK_PATTERN.test(osisBook) &&
      OSIS_TO_USFM[osisBook] != null
      ? OSIS_TO_USFM[osisBook]
      : null
  }

  const bookName = citation.bibleBook?.name
  if (bookName == null) return null

  return BOOK_NAME_TO_USFM[normalizeBookName(bookName)] ?? null
}

function normalizeBookName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function safeReference(value: string) {
  return USFM_REFERENCE_PATTERN.test(value) ? value : null
}
