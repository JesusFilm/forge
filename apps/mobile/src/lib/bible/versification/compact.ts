// The compact form of the Copenhagen Alliance mapping files (KTD6). The app
// imports only systems.generated.ts, which generate-systems.mjs builds with
// buildVersificationSystems. Keep this file free of runtime imports for Node.

/** The six standard systems that the app vendors, in `systems/`. */
export const STANDARD_SYSTEM_IDS = [
  "org",
  "eng",
  "lxx",
  "vul",
  "rsc",
  "rso",
] as const

export type StandardSystemId = (typeof STANDARD_SYSTEM_IDS)[number]

/** A standard system, or `bsb`: eng with BSB's two chapter-end joins. */
export type VersificationSystemId = "bsb" | StandardSystemId

/** One book of one system. The book id is the key, so no text repeats it. */
export type CompactBook = {
  /** The last verse of each chapter, in order: `"14 17 18 6"`. */
  v: string
  /** Mappings to the same book in `org`: `"4:1-6=3:19-24 5:1=4:1"`. */
  m?: string
  /** Verses that map to a book outside this one: `"3:24-90"`. */
  x?: string
}

export type CompactSystem = Readonly<Partial<Record<string, CompactBook>>>

export type CompactSystems = Readonly<
  Record<VersificationSystemId, CompactSystem>
>

export class VersificationDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VersificationDataError"
  }
}

type Reference = { book: string; chapter: number; first: number; last: number }

const REFERENCE = /^([0-9A-Z]{3}) (\d+):(\d+)(?:-(\d+))?$/
const COUNT = /^\d+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseReference(text: unknown): Reference | null {
  const match = typeof text === "string" ? REFERENCE.exec(text) : null
  if (!match) return null
  const [, book = "", chapter = "", first = "", last = first] = match
  const reference = {
    book,
    chapter: Number(chapter),
    first: Number(first),
    last: Number(last),
  }
  return reference.chapter >= 1 && reference.last >= reference.first
    ? reference
    : null
}

function withoutBook(reference: Reference): string {
  const { chapter, first, last } = reference
  return first === last ? `${chapter}:${first}` : `${chapter}:${first}-${last}`
}

function chapterLengths(bookId: string, value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw new VersificationDataError(`${bookId} has no chapter lengths`)
  }
  return value
    .map((length) => {
      const text = String(length)
      if (!COUNT.test(text)) {
        throw new VersificationDataError(`${bookId} has a bad length ${text}`)
      }
      return String(Number(text))
    })
    .join(" ")
}

function append(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

// The compact form of one raw file, for the given books only. A mapping in
// another book is ignored; a malformed mapping in a given book throws.
export function compactSystem(
  raw: unknown,
  bookIds: readonly string[],
): CompactSystem {
  if (!isRecord(raw) || !isRecord(raw.maxVerses)) {
    throw new VersificationDataError("the file has no maxVerses object")
  }
  const mappedVerses = raw.mappedVerses ?? {}
  if (!isRecord(mappedVerses)) {
    throw new VersificationDataError("mappedVerses is not an object")
  }
  const wanted = new Set(bookIds)
  const mapped = new Map<string, string[]>()
  const excluded = new Map<string, string[]>()
  for (const [key, value] of Object.entries(mappedVerses)) {
    const bookId = key.slice(0, 3)
    if (!wanted.has(bookId)) continue
    const from = parseReference(key)
    const to = parseReference(value)
    if (!from || !to || from.book !== bookId) {
      throw new VersificationDataError(`cannot read ${key} => ${String(value)}`)
    }
    if (to.book === bookId) {
      append(mapped, bookId, `${withoutBook(from)}=${withoutBook(to)}`)
    } else {
      append(excluded, bookId, withoutBook(from))
    }
  }

  const result: Record<string, CompactBook> = {}
  for (const bookId of bookIds) {
    const lengths = raw.maxVerses[bookId]
    if (lengths === undefined) continue
    const book: CompactBook = { v: chapterLengths(bookId, lengths) }
    const mappings = mapped.get(bookId)
    if (mappings) book.m = mappings.join(" ")
    const exclusions = excluded.get(bookId)
    if (exclusions) book.x = exclusions.join(" ")
    result[bookId] = book
  }
  return result
}

// Errata to the vendored eng.json, added here so the file stays as upstream.
// eng.json has no ISA 64:1 = org 63:19; rsc.json has this same pair.
const ENG_ERRATA: Readonly<Record<string, string>> = {
  ISA: "63:19=63:19 64:1=63:19",
}

type ChapterJoin = { chapter: number; lastVerse: number; mapping: string }

// BSB's 3 John 1:14 and Revelation 12:17 also hold eng 1:15 and 12:18. The
// only two differences in all of BSB's complete.json (checked 2026-09-25).
const BSB_JOINS: Readonly<Record<string, ChapterJoin>> = {
  "3JN": { chapter: 1, lastVerse: 14, mapping: "1:14=1:14-15" },
  REV: { chapter: 12, lastVerse: 17, mapping: "12:17=12:17-18" },
}

function withMapping(book: CompactBook, mapping: string): CompactBook {
  return { ...book, m: book.m ? `${book.m} ${mapping}` : mapping }
}

function withEntries<T>(
  system: CompactSystem,
  entries: Readonly<Record<string, T>>,
  change: (book: CompactBook, entry: T) => CompactBook,
): CompactSystem {
  const result: Record<string, CompactBook> = {}
  for (const [bookId, book] of Object.entries(system)) {
    if (!book) continue
    const entry = entries[bookId]
    result[bookId] = entry === undefined ? book : change(book, entry)
  }
  return result
}

function withJoin(book: CompactBook, join: ChapterJoin): CompactBook {
  const lengths = book.v.split(" ")
  lengths[join.chapter - 1] = String(join.lastVerse)
  return withMapping({ ...book, v: lengths.join(" ") }, join.mapping)
}

/** Every system the app uses: the six files, the eng errata, and bsb. */
export function buildVersificationSystems(
  raw: Readonly<Record<StandardSystemId, unknown>>,
  bookIds: readonly string[],
): CompactSystems {
  const eng = withEntries(
    compactSystem(raw.eng, bookIds),
    ENG_ERRATA,
    withMapping,
  )
  return {
    org: compactSystem(raw.org, bookIds),
    eng,
    lxx: compactSystem(raw.lxx, bookIds),
    vul: compactSystem(raw.vul, bookIds),
    rsc: compactSystem(raw.rsc, bookIds),
    rso: compactSystem(raw.rso, bookIds),
    bsb: withEntries(eng, BSB_JOINS, withJoin),
  }
}
