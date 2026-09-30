// Picks each book's numbering system from the last verse of each chapter
// (KTD6). It reads only the chapters where the systems disagree. Keep this
// file free of runtime imports, so a Node build script can run it.
import type {
  CompactSystems,
  StandardSystemId,
  VersificationSystemId,
} from "./compact"

/** BSB's catalog id. U3 gives BSB the `bsb` system and never classifies it. */
export const BSB_TRANSLATION_ID = "BSB"

export const BSB_SYSTEM_ID: VersificationSystemId = "bsb"

/** A chapter may end this many verses early (an omitted or merged verse). */
export const MAX_LOWERED_VERSES = 2

/** This many lowered chapters count as agreement; more count as conflicts. */
export const MAX_LOWERED_CHAPTERS = 3

/** The shape of U1's `Chapter`, so its chapters pass in unchanged. */
export type ChapterLastVerse = { number: number; lastVerse: number }

export type BookChapters = {
  /** The highest chapter number that the translation has. */
  chapterCount: number
  /** The last verse by chapter number. A missing chapter is not compared. */
  lastVerses: Readonly<Partial<Record<number, number>>>
}

/** A translation's chapters, by USFM book id. */
export type TranslationChapters = Readonly<
  Partial<Record<string, BookChapters>>
>

/** Chapter numbers per book id, in ascending order. */
export type DiscriminatingChapters = Readonly<
  Partial<Record<string, readonly number[]>>
>

export type BookSystem = StandardSystemId | "unknown"

export type TranslationSystems = {
  /** Wins ties, and is the system for a book that comes out unknown. */
  main: StandardSystemId
  /** One entry per book that at least one standard system numbers. */
  books: Partial<Record<string, BookSystem>>
}

type Score = { system: StandardSystemId; exact: number; conflicts: number }

// Ties go to eng, the most common system. This order placed the most books
// correctly on eight real Bibles (2026-09-25), better than eng, org, rsc.
const PREFERENCE: readonly StandardSystemId[] = [
  "eng",
  "rsc",
  "org",
  "rso",
  "vul",
  "lxx",
]

// Bibles with Hebrew Psalms mostly follow eng in the other books, so only
// Greek-numbered Psalms (Psalm 9 has 39 verses) change the main system.
const GREEK_PSALM_SYSTEMS: ReadonlySet<StandardSystemId> = new Set([
  "rsc",
  "rso",
  "vul",
  "lxx",
])

const ALL_SYSTEMS: readonly VersificationSystemId[] = [...PREFERENCE, "bsb"]

function lengthsOf(
  systems: CompactSystems,
  system: VersificationSystemId,
  bookId: string,
): number[] | null {
  const book = systems[system][bookId]
  return book ? book.v.split(" ").map(Number) : null
}

const discriminatingCache = new WeakMap<
  CompactSystems,
  DiscriminatingChapters
>()

/**
 * Chapters where two systems (bsb too) differ in last verse or in existence.
 */
export function discriminatingChapters(
  systems: CompactSystems,
): DiscriminatingChapters {
  const cached = discriminatingCache.get(systems)
  if (cached) return cached
  const bookIds = new Set(ALL_SYSTEMS.flatMap((id) => Object.keys(systems[id])))
  const result: Record<string, number[]> = {}
  for (const bookId of bookIds) {
    const lengths = ALL_SYSTEMS.map((id) =>
      lengthsOf(systems, id, bookId),
    ).filter((list) => list !== null)
    const chapterCount = Math.max(...lengths.map((list) => list.length))
    const chapters: number[] = []
    for (let chapter = 1; chapter <= chapterCount; chapter += 1) {
      const values = new Set(lengths.map((list) => list[chapter - 1]))
      if (values.size > 1) chapters.push(chapter)
    }
    result[bookId] = chapters
  }
  discriminatingCache.set(systems, result)
  return result
}

/** A book's facts from its chapters; `keep` limits which chapters stay. */
export function bookChapters(
  chapters: readonly ChapterLastVerse[],
  keep?: readonly number[],
): BookChapters {
  const kept = keep ? new Set(keep) : null
  const lastVerses: Record<number, number> = {}
  let chapterCount = 0
  for (const chapter of chapters) {
    chapterCount = Math.max(chapterCount, chapter.number)
    if (!kept || kept.has(chapter.number)) {
      lastVerses[chapter.number] = chapter.lastVerse
    }
  }
  return { chapterCount, lastVerses }
}

function score(
  system: StandardSystemId,
  lengths: readonly number[],
  chapters: BookChapters,
  compared: readonly number[],
): Score | null {
  let exact = 0
  let lowered = 0
  let conflicts = 0
  for (const chapter of compared) {
    const fact = chapters.lastVerses[chapter]
    const mapped = lengths[chapter - 1]
    if (fact === undefined || mapped === undefined) continue
    const shortBy = mapped - fact
    if (shortBy === 0) exact += 1
    else if (shortBy > 0 && shortBy <= MAX_LOWERED_VERSES) lowered += 1
    else conflicts += 1
  }
  conflicts += Math.max(0, lowered - MAX_LOWERED_CHAPTERS)
  const agreeing = exact + Math.min(lowered, MAX_LOWERED_CHAPTERS)
  // Too weak: more of the compared chapters conflict than agree.
  return conflicts > agreeing ? null : { system, exact, conflicts }
}

/**
 * One book's system: the most exact chapters, then the fewest conflicts.
 */
export function classifyBook(
  bookId: string,
  chapters: BookChapters,
  main: StandardSystemId,
  systems: CompactSystems,
): BookSystem {
  const compared = discriminatingChapters(systems)[bookId] ?? []
  const scores: Score[] = []
  for (const system of PREFERENCE) {
    const lengths = lengthsOf(systems, system, bookId)
    if (!lengths || lengths.length !== chapters.chapterCount) continue
    const result = score(system, lengths, chapters, compared)
    if (result) scores.push(result)
  }
  scores.sort(
    (a, b) =>
      b.exact - a.exact ||
      a.conflicts - b.conflicts ||
      Number(b.system === main) - Number(a.system === main) ||
      PREFERENCE.indexOf(a.system) - PREFERENCE.indexOf(b.system),
  )
  return scores[0]?.system ?? "unknown"
}

/** Every book's system. A book that no standard system numbers is left out. */
export function classifyTranslation(
  translation: TranslationChapters,
  systems: CompactSystems,
): TranslationSystems {
  const psalms = translation.PSA
  const psalmSystem = psalms
    ? classifyBook("PSA", psalms, "eng", systems)
    : "unknown"
  const main =
    psalmSystem !== "unknown" && GREEK_PSALM_SYSTEMS.has(psalmSystem)
      ? psalmSystem
      : "eng"

  const books: Partial<Record<string, BookSystem>> = {}
  for (const [bookId, chapters] of Object.entries(translation)) {
    if (!chapters || !PREFERENCE.some((id) => systems[id][bookId])) continue
    books[bookId] = classifyBook(bookId, chapters, main, systems)
  }
  return { main, books }
}

/** The system to use for a book: its own, or `main` when it is unknown. */
export function resolveBookSystem(
  result: TranslationSystems,
  bookId: string,
): StandardSystemId {
  const system = result.books[bookId]
  return system === undefined || system === "unknown" ? result.main : system
}
