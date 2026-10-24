// Verse-number conversion between BSB and a translation's system (KTD6, R38).
// Every conversion goes source -> org -> target, unless both systems number
// the book the same way. Pure: the only data is systems.generated.ts.
import type { UsfmBookId } from "../text/books"
import type { CompactBook, VersificationSystemId } from "./compact"
import { VERSIFICATION_SYSTEMS } from "./systems.generated"

export type { VersificationSystemId }

export const VERSIFICATION_SYSTEM_IDS = [
  "bsb",
  "org",
  "eng",
  "lxx",
  "vul",
  "rsc",
  "rso",
] as const satisfies readonly VersificationSystemId[]

/** One verse, in the numbering of one system. */
export type VerseRef = { book: UsfmBookId; chapter: number; verse: number }

/** chapter * SCALE + verse. No chapter has 1000 verses. */
type Position = number

const SCALE = 1000

type ParsedBook = {
  data: CompactBook
  /** The last verse of each chapter; index 0 is chapter 1. */
  lastVerses: readonly number[]
  /** Explicit mappings to org. `null` means the verse maps out of the book. */
  toOrg: ReadonlyMap<Position, readonly Position[] | null>
  /** The inverse of `toOrg`. */
  fromOrg: ReadonlyMap<Position, readonly Position[]>
}

const VERSIFICATION_SYSTEM_ID_SET: ReadonlySet<string> = new Set(
  VERSIFICATION_SYSTEM_IDS,
)

export function isVersificationSystemId(
  value: string,
): value is VersificationSystemId {
  return VERSIFICATION_SYSTEM_ID_SET.has(value)
}

function chapterOf(position: Position): number {
  return Math.floor(position / SCALE)
}

function verseOf(position: Position): number {
  return position % SCALE
}

function rangePositions(text: string): Position[] {
  const [chapterText = "", versesText = ""] = text.split(":")
  const [firstText = "", lastText = firstText] = versesText.split("-")
  const chapter = Number(chapterText)
  const first = Number(firstText)
  const last = Number(lastText)
  if (![chapter, first, last].every(Number.isInteger) || last < first) {
    return []
  }
  const positions: Position[] = []
  for (let verse = first; verse <= last; verse += 1) {
    positions.push(chapter * SCALE + verse)
  }
  return positions
}

function addTo<T>(map: Map<Position, T[]>, key: Position, value: T) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

// When the two sides differ in length, the shorter side's last verse pairs
// with the rest: rso "89:2-6=90:1-6" gives 89:6 both 90:5 and 90:6.
function parseBook(data: CompactBook): ParsedBook {
  const toOrg = new Map<Position, Position[] | null>()
  const fromOrg = new Map<Position, Position[]>()
  for (const range of data.x?.split(" ") ?? []) {
    for (const position of rangePositions(range)) toOrg.set(position, null)
  }
  for (const entry of data.m?.split(" ") ?? []) {
    const [left = "", right = ""] = entry.split("=")
    const from = rangePositions(left)
    const to = rangePositions(right)
    const pairs = Math.max(from.length, to.length)
    for (let index = 0; index < pairs && from.length && to.length; index += 1) {
      const source = from[Math.min(index, from.length - 1)] ?? 0
      const target = to[Math.min(index, to.length - 1)] ?? 0
      const known = toOrg.get(source)
      if (known) known.push(target)
      else toOrg.set(source, [target])
      addTo(fromOrg, target, source)
    }
  }
  return {
    data,
    lastVerses: data.v.split(" ").map(Number),
    toOrg,
    fromOrg,
  }
}

const parsed = new Map<string, ParsedBook | null>()

function bookOf(
  system: VersificationSystemId,
  book: UsfmBookId,
): ParsedBook | null {
  const key = `${system} ${book}`
  const cached = parsed.get(key)
  if (cached !== undefined) return cached
  const data = VERSIFICATION_SYSTEMS[system][book]
  const result = data ? parseBook(data) : null
  parsed.set(key, result)
  return result
}

function isValid(book: ParsedBook, position: Position): boolean {
  const last = book.lastVerses[chapterOf(position) - 1]
  const verse = verseOf(position)
  return last !== undefined && verse >= 1 && verse <= last
}

/** The org verse for a verse of `book`, or null if it maps out of the book. */
function orgOf(book: ParsedBook, position: Position): Position | null {
  const mapped = book.toOrg.get(position)
  if (mapped === undefined) return position
  return mapped === null ? null : Math.min(...mapped)
}

// An explicit mapping beats the same number: eng maps 7:69 to org NEH 7:68,
// so org 7:68 is eng 7:69 even though eng also has a verse 7:68.
function counterpartsOf(book: ParsedBook, org: Position): Position[] {
  const explicit = book.fromOrg.get(org)
  if (explicit) {
    return explicit
      .filter((position) => isValid(book, position))
      .sort((a, b) => a - b)
  }
  return !book.toOrg.has(org) && isValid(book, org) ? [org] : []
}

function nextPosition(
  lastVerses: readonly number[],
  position: Position,
): Position | null {
  let chapter = chapterOf(position)
  let verse = verseOf(position) + 1
  while (chapter <= lastVerses.length) {
    if (chapter >= 1 && verse <= (lastVerses[chapter - 1] ?? 0)) {
      return chapter * SCALE + verse
    }
    chapter += 1
    verse = 1
  }
  return null
}

function previousPosition(
  lastVerses: readonly number[],
  position: Position,
): Position | null {
  let chapter = chapterOf(position)
  let verse = verseOf(position) - 1
  if (chapter > lastVerses.length) {
    chapter = lastVerses.length
    verse = Infinity
  }
  while (chapter >= 1) {
    const candidate = Math.min(verse, lastVerses[chapter - 1] ?? 0)
    if (candidate >= 1) return chapter * SCALE + candidate
    chapter -= 1
    verse = Infinity
  }
  return null
}

// R38: a verse with no counterpart anchors to the next verse that has one.
// Only at the end of the book does the search go back.
function firstFound(
  lastVerses: readonly number[],
  start: Position,
  find: (position: Position) => Position | null,
): Position | null {
  const direct = find(start)
  if (direct !== null) return direct
  for (
    let position = nextPosition(lastVerses, start);
    position !== null;
    position = nextPosition(lastVerses, position)
  ) {
    const found = find(position)
    if (found !== null) return found
  }
  for (
    let position = previousPosition(lastVerses, start);
    position !== null;
    position = previousPosition(lastVerses, position)
  ) {
    const found = find(position)
    if (found !== null) return found
  }
  return null
}

function sameNumbering(a: ParsedBook, b: ParsedBook): boolean {
  return a.data.v === b.data.v && a.data.m === b.data.m && a.data.x === b.data.x
}

function isPosition(ref: VerseRef): boolean {
  const { chapter, verse } = ref
  return (
    Number.isInteger(chapter) &&
    chapter >= 1 &&
    Number.isInteger(verse) &&
    verse >= 0 &&
    verse < SCALE
  )
}

/**
 * Converts a verse between systems. A bad reference or a missing book keeps it.
 */
export function convertVerse(
  ref: VerseRef,
  from: VersificationSystemId,
  to: VersificationSystemId,
): VerseRef {
  if (from === to || !isPosition(ref)) return ref
  const source = bookOf(from, ref.book)
  const target = bookOf(to, ref.book)
  const org = bookOf("org", ref.book)
  if (!source || !target || !org) return ref
  // Many-to-one mappings lose a verse on the way through org.
  if (sameNumbering(source, target)) return ref

  const start = ref.chapter * SCALE + ref.verse
  const found = firstFound(source.lastVerses, start, (position) => {
    const orgPosition = orgOf(source, position)
    if (orgPosition === null) return null
    // Two verses that share one org verse keep their order: the second
    // source verse takes the second target verse (BSB 64:1 -> rsc 64:1).
    const rank = counterpartsOf(source, orgPosition).indexOf(position)
    return firstFound(org.lastVerses, orgPosition, (candidate) => {
      const matches = counterpartsOf(target, candidate)
      const index = candidate === orgPosition ? Math.max(rank, 0) : 0
      return matches[Math.min(index, matches.length - 1)] ?? null
    })
  })
  if (found === null) return ref
  return { book: ref.book, chapter: chapterOf(found), verse: verseOf(found) }
}

/** A BSB reference (quotes, saved position) in a translation's numbering. */
export function fromBsb(ref: VerseRef, to: VersificationSystemId): VerseRef {
  return convertVerse(ref, "bsb", to)
}

/** A translation's reference in BSB numbering, for storage (KD23). */
export function toBsb(ref: VerseRef, from: VersificationSystemId): VerseRef {
  return convertVerse(ref, from, "bsb")
}

/**
 * A system's last verse for a chapter, for the KTD6 mismatch log, if any.
 */
export function mappedLastVerse(
  system: VersificationSystemId,
  book: UsfmBookId,
  chapter: number,
): number | undefined {
  if (!Number.isInteger(chapter) || chapter < 1) return undefined
  return bookOf(system, book)?.lastVerses[chapter - 1]
}
