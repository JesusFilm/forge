export type Testament = "old" | "new"

type BibleBookEntry = {
  /** The USFM code, which bible.helloao.org uses as its book id. */
  usfm: string
  /** The OSIS id, which admin's `BibleBook.osisId` carries. */
  osis: string
  /** BSB's short English name, the fallback when a source has no name. */
  name: string
  testament: Testament
}

/** The 66 books in BSB order. */
export const BIBLE_BOOKS = [
  { usfm: "GEN", osis: "Gen", name: "Genesis", testament: "old" },
  { usfm: "EXO", osis: "Exod", name: "Exodus", testament: "old" },
  { usfm: "LEV", osis: "Lev", name: "Leviticus", testament: "old" },
  { usfm: "NUM", osis: "Num", name: "Numbers", testament: "old" },
  { usfm: "DEU", osis: "Deut", name: "Deuteronomy", testament: "old" },
  { usfm: "JOS", osis: "Josh", name: "Joshua", testament: "old" },
  { usfm: "JDG", osis: "Judg", name: "Judges", testament: "old" },
  { usfm: "RUT", osis: "Ruth", name: "Ruth", testament: "old" },
  { usfm: "1SA", osis: "1Sam", name: "1 Samuel", testament: "old" },
  { usfm: "2SA", osis: "2Sam", name: "2 Samuel", testament: "old" },
  { usfm: "1KI", osis: "1Kgs", name: "1 Kings", testament: "old" },
  { usfm: "2KI", osis: "2Kgs", name: "2 Kings", testament: "old" },
  { usfm: "1CH", osis: "1Chr", name: "1 Chronicles", testament: "old" },
  { usfm: "2CH", osis: "2Chr", name: "2 Chronicles", testament: "old" },
  { usfm: "EZR", osis: "Ezra", name: "Ezra", testament: "old" },
  { usfm: "NEH", osis: "Neh", name: "Nehemiah", testament: "old" },
  { usfm: "EST", osis: "Esth", name: "Esther", testament: "old" },
  { usfm: "JOB", osis: "Job", name: "Job", testament: "old" },
  { usfm: "PSA", osis: "Ps", name: "Psalms", testament: "old" },
  { usfm: "PRO", osis: "Prov", name: "Proverbs", testament: "old" },
  { usfm: "ECC", osis: "Eccl", name: "Ecclesiastes", testament: "old" },
  { usfm: "SNG", osis: "Song", name: "Song of Solomon", testament: "old" },
  { usfm: "ISA", osis: "Isa", name: "Isaiah", testament: "old" },
  { usfm: "JER", osis: "Jer", name: "Jeremiah", testament: "old" },
  { usfm: "LAM", osis: "Lam", name: "Lamentations", testament: "old" },
  { usfm: "EZK", osis: "Ezek", name: "Ezekiel", testament: "old" },
  { usfm: "DAN", osis: "Dan", name: "Daniel", testament: "old" },
  { usfm: "HOS", osis: "Hos", name: "Hosea", testament: "old" },
  { usfm: "JOL", osis: "Joel", name: "Joel", testament: "old" },
  { usfm: "AMO", osis: "Amos", name: "Amos", testament: "old" },
  { usfm: "OBA", osis: "Obad", name: "Obadiah", testament: "old" },
  { usfm: "JON", osis: "Jonah", name: "Jonah", testament: "old" },
  { usfm: "MIC", osis: "Mic", name: "Micah", testament: "old" },
  { usfm: "NAM", osis: "Nah", name: "Nahum", testament: "old" },
  { usfm: "HAB", osis: "Hab", name: "Habakkuk", testament: "old" },
  { usfm: "ZEP", osis: "Zeph", name: "Zephaniah", testament: "old" },
  { usfm: "HAG", osis: "Hag", name: "Haggai", testament: "old" },
  { usfm: "ZEC", osis: "Zech", name: "Zechariah", testament: "old" },
  { usfm: "MAL", osis: "Mal", name: "Malachi", testament: "old" },
  { usfm: "MAT", osis: "Matt", name: "Matthew", testament: "new" },
  { usfm: "MRK", osis: "Mark", name: "Mark", testament: "new" },
  { usfm: "LUK", osis: "Luke", name: "Luke", testament: "new" },
  { usfm: "JHN", osis: "John", name: "John", testament: "new" },
  { usfm: "ACT", osis: "Acts", name: "Acts", testament: "new" },
  { usfm: "ROM", osis: "Rom", name: "Romans", testament: "new" },
  { usfm: "1CO", osis: "1Cor", name: "1 Corinthians", testament: "new" },
  { usfm: "2CO", osis: "2Cor", name: "2 Corinthians", testament: "new" },
  { usfm: "GAL", osis: "Gal", name: "Galatians", testament: "new" },
  { usfm: "EPH", osis: "Eph", name: "Ephesians", testament: "new" },
  { usfm: "PHP", osis: "Phil", name: "Philippians", testament: "new" },
  { usfm: "COL", osis: "Col", name: "Colossians", testament: "new" },
  { usfm: "1TH", osis: "1Thess", name: "1 Thessalonians", testament: "new" },
  { usfm: "2TH", osis: "2Thess", name: "2 Thessalonians", testament: "new" },
  { usfm: "1TI", osis: "1Tim", name: "1 Timothy", testament: "new" },
  { usfm: "2TI", osis: "2Tim", name: "2 Timothy", testament: "new" },
  { usfm: "TIT", osis: "Titus", name: "Titus", testament: "new" },
  { usfm: "PHM", osis: "Phlm", name: "Philemon", testament: "new" },
  { usfm: "HEB", osis: "Heb", name: "Hebrews", testament: "new" },
  { usfm: "JAS", osis: "Jas", name: "James", testament: "new" },
  { usfm: "1PE", osis: "1Pet", name: "1 Peter", testament: "new" },
  { usfm: "2PE", osis: "2Pet", name: "2 Peter", testament: "new" },
  { usfm: "1JN", osis: "1John", name: "1 John", testament: "new" },
  { usfm: "2JN", osis: "2John", name: "2 John", testament: "new" },
  { usfm: "3JN", osis: "3John", name: "3 John", testament: "new" },
  { usfm: "JUD", osis: "Jude", name: "Jude", testament: "new" },
  { usfm: "REV", osis: "Rev", name: "Revelation", testament: "new" },
] as const satisfies readonly BibleBookEntry[]

export type BibleBook = (typeof BIBLE_BOOKS)[number]
export type UsfmBookId = BibleBook["usfm"]
export type OsisBookId = BibleBook["osis"]

const USFM_IDS: ReadonlySet<string> = new Set(
  BIBLE_BOOKS.map((book) => book.usfm),
)
const BY_USFM = Object.fromEntries(
  BIBLE_BOOKS.map((book) => [book.usfm, book]),
) as Record<UsfmBookId, BibleBook>
const ORDER = Object.fromEntries(
  BIBLE_BOOKS.map((book, index) => [book.usfm, index]),
) as Record<UsfmBookId, number>
const BY_OSIS = new Map<string, BibleBook>(
  BIBLE_BOOKS.map((book) => [book.osis, book]),
)

export function isUsfmBookId(value: string): value is UsfmBookId {
  return USFM_IDS.has(value)
}

export function bookByUsfm(id: UsfmBookId): BibleBook {
  return BY_USFM[id]
}

export function bookByOsis(osis: string): BibleBook | undefined {
  return BY_OSIS.get(osis)
}

/** The book's zero-based position in BSB order (GEN is 0, REV is 65). */
export function bookOrder(id: UsfmBookId): number {
  return ORDER[id]
}
