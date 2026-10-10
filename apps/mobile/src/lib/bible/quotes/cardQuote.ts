// A Bible quote card's verse from the reader's own translation (plan
// 2026-10-08, KTD1). Pure apart from the injected services, so it runs
// without React. The hook decides when each phase runs (KTD4, KTD5).
import type { WatchBibleCitation } from "../../normalizeVideo"
import type { BundledResult } from "../data/bundled"
import type { Catalog, CatalogTranslation } from "../data/catalog"
import { resolveShownTranslation } from "../language/defaultTranslation"
import { catalogLanguageTag } from "../language/phoneLanguage"
import { isBsbVerseRef } from "../position/snapshot"
import type { ReadingPositionStore } from "../position/store"
import {
  toBsbRef,
  toTranslationRef,
  type ChapterRepository,
  type ChapterRequest,
} from "../repository/resolveChapter"
import type { TranslationDownloads } from "../repository/translationDownloads"
import type { UsfmBookId } from "../text/books"
import { verseThrough } from "../text/positions"
import type { ChapterText, TextDirection, Verse } from "../text/types"
import { mappedLastVerse, type VerseRef } from "../versification/convert"

/** A longer quote shows admin's card (KTD6). */
const MAX_CHAPTERS = 2

const ENGLISH = "eng"

export type CardQuoteServices = {
  repository: Pick<
    ChapterRepository,
    "resolve" | "readOnDevice" | "isOnDevice" | "translationHasBook"
  >
  downloads: Pick<TranslationDownloads, "check">
  /** Never rejects. */
  loadCatalog: () => Promise<BundledResult<Catalog>>
  positionStore: Pick<ReadingPositionStore, "hydrate" | "getSnapshot">
  readPhoneLanguage: () => string | null
}

export type CardCitation = Pick<
  WatchBibleCitation,
  | "documentId"
  | "bookUsfm"
  | "chapterStart"
  | "chapterEnd"
  | "verseStart"
  | "verseEnd"
>

/** The citation in the translation's own numbers, for `formatCitationLabel`. */
export type CardQuoteReference = {
  /** The chapter file's book name, which is English when it has none (R6). */
  bookName: string
  chapterStart: number
  chapterEnd: number | null
  verseStart: number | null
  verseEnd: number | null
}

export type CardQuote = {
  text: string
  reference: CardQuoteReference
  /** The translation's own full name (R7). */
  translationName: string
  /** The catalog's credit line, as the catalog writes it (R7). */
  credit: string
  textDirection: TextDirection
  /** BCP-47: the screen-reader language and the reference's upper case. */
  languageTag: string
}

export type CardQuoteFallbackReason =
  /** The saved pick or the catalog did not load (KTD8). */
  | "unknown-translation"
  /** No exact verse for the citation, or the reader opens elsewhere (KTD6). */
  | "no-verse"
  /** More than `MAX_CHAPTERS` translation chapters (KTD6). */
  | "too-long"
  | "read-failed"
  /** A service threw. */
  | "error"

export type CardQuoteResult =
  /** The book is not known yet, so the card waits (KTD9). */
  | { status: "pending" }
  /** The reader translation is English: admin's card stays (R1, R2). */
  | { status: "admin"; translationId: string }
  | { status: "local"; translationId: string; quote: CardQuote }
  | {
      status: "fallback"
      translationId: string | null
      reason: CardQuoteFallbackReason
    }
  /** Device reach only: the chapter needs a network read. */
  | { status: "network"; translationId: string }

export type CardQuoteInput = {
  citations: readonly CardCitation[]
  /** `WatchPreferences.audioLanguageIso3`. */
  audioLanguage: string | null
  /** `device` reads only the device; `network` may also fetch (KTD4). */
  reach: "device" | "network"
}

/** KTD9: the citation's content, because a partial citation republishes. */
export function cardQuoteKey(citation: CardCitation): string {
  const { documentId, bookUsfm, chapterStart, chapterEnd } = citation
  const { verseStart, verseEnd } = citation
  return [documentId, bookUsfm, chapterStart, chapterEnd, verseStart, verseEnd]
    .map((part) => part ?? "")
    .join("|")
}

const PENDING: CardQuoteResult = { status: "pending" }

function fallback(
  translationId: string | null,
  reason: CardQuoteFallbackReason,
): CardQuoteResult {
  return { status: "fallback", translationId, reason }
}

function sameRef(a: VerseRef, b: VerseRef): boolean {
  return a.book === b.book && a.chapter === b.chapter && a.verse === b.verse
}

type Translations = ReadonlyMap<UsfmBookId, CatalogTranslation | null>

// KTD2: the reader's own rules and inputs, so "Read full passage" opens the
// translation that the card shows. The reader starts with `offline: false`.
async function translationsFor(
  services: CardQuoteServices,
  books: readonly { book: UsfmBookId; ref: VerseRef }[],
  audioLanguage: string | null,
): Promise<Translations | "unknown-translation"> {
  if ((await services.positionStore.hydrate()) === "missed") {
    return "unknown-translation"
  }
  try {
    await services.downloads.check()
  } catch {
    // A failed check reads every translation as not downloaded.
  }
  const catalog = await services.loadCatalog()
  if (catalog.status !== "ok") return "unknown-translation"
  const position = services.positionStore.getSnapshot()
  const phoneLanguage = services.readPhoneLanguage()
  const byBook = new Map<UsfmBookId, CatalogTranslation | null>()
  for (const { book, ref } of books) {
    if (byBook.has(book)) continue
    const shown = await resolveShownTranslation({
      catalog: catalog.value,
      sessionTranslationId: position.sessionTranslationId,
      explicitTranslationId: position.translationId,
      audioLanguage,
      phoneLanguage,
      ref,
      offline: false,
      isOnDevice: (request) => services.repository.isOnDevice(request),
      hasBook: (translation, bookId) =>
        services.repository.translationHasBook(translation, bookId),
    })
    byBook.set(book, shown?.translation ?? null)
  }
  return byBook
}

type ReadPlan = {
  book: UsfmBookId
  /** The translation chapters to read, in order. */
  chapters: number[]
  /** The ends, in the translation's numbers. */
  start: VerseRef
  end: VerseRef
  /** The cited BSB chapter of a whole-chapter citation. */
  wholeChapter: number | null
}

/** A BSB verse in the translation's numbers, only when the round trip holds. */
function exactRef(ref: VerseRef, translationId: string): VerseRef | null {
  const converted = toTranslationRef(ref, translationId)
  return sameRef(toBsbRef(converted, translationId), ref) ? converted : null
}

function planRead(
  citation: CardCitation,
  book: UsfmBookId,
  translationId: string,
): ReadPlan | CardQuoteFallbackReason {
  const { chapterStart, verseStart, verseEnd } = citation
  if (chapterStart == null) return "no-verse"
  const bsbStart = { book, chapter: chapterStart, verse: verseStart ?? 1 }
  // The reader opens at this verse (citationReaderStart); a verse that BSB
  // lacks would open it elsewhere.
  if (!isBsbVerseRef(bsbStart)) return "no-verse"
  const endChapter = citation.chapterEnd ?? chapterStart
  let bsbEnd: VerseRef = bsbStart
  if (verseEnd != null) {
    bsbEnd = { book, chapter: endChapter, verse: verseEnd }
  } else if (verseStart == null || endChapter !== chapterStart) {
    const last = mappedLastVerse("bsb", book, endChapter)
    if (last === undefined) return "no-verse"
    bsbEnd = { book, chapter: endChapter, verse: last }
  }
  const start = exactRef(bsbStart, translationId)
  const end = exactRef(bsbEnd, translationId)
  if (!start || !end || end.chapter < start.chapter) return "no-verse"
  const chapters: number[] = []
  for (let chapter = start.chapter; chapter <= end.chapter; chapter += 1) {
    chapters.push(chapter)
  }
  if (chapters.length > MAX_CHAPTERS) return "too-long"
  return {
    book,
    chapters,
    start,
    end,
    wholeChapter: verseStart == null ? chapterStart : null,
  }
}

function coveringVerse(text: ChapterText, number: number): Verse | undefined {
  return text.chapter.verses.find(
    (verse) => verse.number <= number && number <= verseThrough(verse),
  )
}

type Stop = { chapter: number; verse: Verse }

// KTD6: each end must be a verse, not a gap; the verses that exist between
// them show, and a merged verse counts by every number it covers.
function selectStops(
  texts: readonly ChapterText[],
  plan: ReadPlan,
  translationId: string,
): Stop[] {
  const first = texts[0]
  const last = texts[texts.length - 1]
  if (!first || !last) return []
  const startVerse = coveringVerse(first, plan.start.verse)
  const endVerse = coveringVerse(last, plan.end.verse)
  if (!startVerse || !endVerse) return []
  let from = startVerse.number
  if (plan.wholeChapter !== null) {
    // The chapter's first stop that belongs to the cited BSB chapter: a
    // Synodal Psalm title does, and a verse of the BSB chapter before does not.
    const opening = first.chapter.verses.find(
      (verse) =>
        toBsbRef(
          {
            book: plan.book,
            chapter: first.chapter.number,
            verse: verse.number,
          },
          translationId,
        ).chapter === plan.wholeChapter,
    )
    if (opening) from = Math.min(from, opening.number)
  }
  const stops: Stop[] = []
  texts.forEach((text, index) => {
    for (const verse of text.chapter.verses) {
      if (index === 0 && verse.number < from) continue
      if (index === texts.length - 1 && verse.number > endVerse.number) continue
      stops.push({ chapter: text.chapter.number, verse })
    }
  })
  return stops
}

function quoteOf(
  texts: readonly ChapterText[],
  plan: ReadPlan,
  translation: CatalogTranslation,
): CardQuote | null {
  const stops = selectStops(texts, plan, translation.id)
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!first || !last || !texts[0]) return null
  const crossChapter = last.chapter !== first.chapter
  const through = verseThrough(last.verse)
  const lastVerses = texts[texts.length - 1]?.chapter.verses ?? []
  // A chapter label fits only stops that fill their chapters: BSB Psalm 10
  // is Synodal 9:22-39, so it keeps its verse numbers.
  const whole =
    plan.wholeChapter !== null &&
    first.verse === texts[0].chapter.verses[0] &&
    last.verse === lastVerses[lastVerses.length - 1]
  return {
    text: stops
      .flatMap((stop) => stop.verse.lines.map((line) => line.text))
      .join(" "),
    reference: {
      bookName: texts[0].bookName,
      chapterStart: first.chapter,
      chapterEnd: crossChapter ? last.chapter : null,
      verseStart: whole ? null : first.verse.number,
      verseEnd:
        whole || (!crossChapter && through === first.verse.number)
          ? null
          : through,
    },
    translationName: translation.name,
    credit: translation.credit,
    textDirection: translation.textDirection,
    languageTag: catalogLanguageTag(translation.language),
  }
}

async function readChapters(
  services: CardQuoteServices,
  requests: readonly ChapterRequest[],
  reach: CardQuoteInput["reach"],
): Promise<ChapterText[] | "network" | "read-failed"> {
  if (reach === "device") {
    const found = await Promise.all(
      requests.map((request) => services.repository.readOnDevice(request)),
    )
    const texts = found.flatMap((result) => (result ? [result.text] : []))
    return texts.length === requests.length ? texts : "network"
  }
  const resolved = await Promise.all(
    requests.map((request) =>
      services.repository.resolve(request, { source: "quote" }),
    ),
  )
  const texts = resolved.flatMap((result) =>
    result.status === "ok" ? [result.text] : [],
  )
  return texts.length === requests.length ? texts : "read-failed"
}

async function quoteFor(
  services: CardQuoteServices,
  citation: CardCitation,
  book: UsfmBookId,
  translation: CatalogTranslation | null,
  reach: CardQuoteInput["reach"],
): Promise<CardQuoteResult> {
  if (translation == null) return fallback(null, "unknown-translation")
  const translationId = translation.id
  if (translation.language === ENGLISH)
    return { status: "admin", translationId }
  const plan = planRead(citation, book, translationId)
  if (typeof plan === "string") return fallback(translationId, plan)
  try {
    const texts = await readChapters(
      services,
      plan.chapters.map((chapter) => ({
        translationId,
        bookId: book,
        chapter,
        sha256: translation.sha256,
      })),
      reach,
    )
    if (texts === "network") return { status: "network", translationId }
    if (texts === "read-failed") return fallback(translationId, "read-failed")
    const quote = quoteOf(texts, plan, translation)
    return quote
      ? { status: "local", translationId, quote }
      : fallback(translationId, "no-verse")
  } catch {
    return fallback(translationId, "error")
  }
}

/** Never rejects. One result per citation, keyed by `cardQuoteKey`. */
export async function resolveCardQuotes(
  services: CardQuoteServices,
  input: CardQuoteInput,
): Promise<ReadonlyMap<string, CardQuoteResult>> {
  const results = new Map<string, CardQuoteResult>()
  const cited: { citation: CardCitation; book: UsfmBookId; ref: VerseRef }[] =
    []
  for (const citation of input.citations) {
    const book = citation.bookUsfm
    if (book == null) {
      results.set(cardQuoteKey(citation), PENDING)
      continue
    }
    const ref = {
      book,
      chapter: citation.chapterStart ?? 1,
      verse: citation.verseStart ?? 1,
    }
    cited.push({ citation, book, ref })
  }
  if (cited.length === 0) return results

  let translations: Translations | CardQuoteFallbackReason
  try {
    translations = await translationsFor(services, cited, input.audioLanguage)
  } catch {
    translations = "error"
  }
  if (typeof translations === "string") {
    for (const { citation } of cited) {
      results.set(cardQuoteKey(citation), fallback(null, translations))
    }
    return results
  }
  const known = translations
  await Promise.all(
    cited.map(async ({ citation, book }) => {
      const translation = known.get(book) ?? null
      results.set(
        cardQuoteKey(citation),
        await quoteFor(services, citation, book, translation, input.reach),
      )
    }),
  )
  return results
}
