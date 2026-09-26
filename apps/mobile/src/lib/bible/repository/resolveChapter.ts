// The chapter resolver (feat-553 U4), in the "Text sources" order: BSB in the
// app, a download, a kept chapter, then bible.helloao.org. A request uses the
// translation's own numbering; convert a BSB reference with toTranslationRef.
import type { BundledResult } from "../data/bundled"
import type { Catalog, CatalogTranslation } from "../data/catalog"
import type { UsfmBookId } from "../text/books"
import type { BookText, ChapterText } from "../text/types"
import { BSB_TRANSLATION_ID } from "../versification/classify"
import { fromBsb, toBsb, type VerseRef } from "../versification/convert"
import { translationBookSystem } from "../versification/translationSystems.generated"
import type { ChapterCache, ChapterCacheKey } from "./chapterCache"
import { chapterFailure, type ChapterFailure } from "./errors"
import type { ChapterAddress, ChapterFetchResult } from "./fetchChapter"
import type { TranslationDownloads } from "./translationDownloads"

const BUNDLED_MEMO_SIZE = 2

/** A chapter address plus the catalog `sha256`, the key for kept chapters. */
export type ChapterRequest = ChapterCacheKey

export type ChapterSource = "bundled" | "downloaded" | "kept" | "network"

export type ResolvedChapter = {
  status: "ok"
  text: ChapterText
  source: ChapterSource
  /** Kept under an older catalog sha256; shows only when a refetch fails. */
  stale: boolean
}

export type ChapterResolution = ResolvedChapter | ChapterFailure

/** The reader moved to another chapter before this one resolved. */
export type SupersededChapter = { status: "superseded" }

export type ShownChapter = ChapterResolution | SupersededChapter

export type ChapterSources = {
  loadBundledBook: (bookId: UsfmBookId) => Promise<BundledResult<BookText>>
  downloads: Pick<TranslationDownloads, "check" | "getState" | "readBook">
  cache: ChapterCache
  fetchChapter: (address: ChapterAddress) => Promise<ChapterFetchResult>
}

/** One per reader screen: it answers only for the chapter shown last. */
export type ChapterView = {
  show(request: ChapterRequest): Promise<ShownChapter>
}

export type ChapterRepository = {
  /** Never rejects. Two calls for one chapter share one read. */
  resolve(request: ChapterRequest): Promise<ChapterResolution>
  createView(): ChapterView
  /** Keeps the next chapter, only after the network last answered. */
  prefetch(request: ChapterRequest): void
  /** R41: BSB, a downloaded book, or a kept chapter of any version. */
  isOnDevice(request: ChapterRequest): Promise<boolean>
  /** A download's manifest wins over the catalog's book list (R25). */
  translationHasBook(
    translation: CatalogTranslation,
    bookId: UsfmBookId,
  ): boolean
}

const SUPERSEDED: SupersededChapter = { status: "superseded" }

function resolved(
  text: ChapterText,
  source: ChapterSource,
  stale = false,
): ResolvedChapter {
  return { status: "ok", text, source, stale }
}

function chapterOf(book: BookText, number: number): ChapterText | null {
  const chapter = book.chapters.find((item) => item.number === number)
  if (!chapter) return null
  return {
    formatVersion: book.formatVersion,
    translationId: book.translationId,
    bookId: book.bookId,
    bookName: book.bookName,
    textDirection: book.textDirection,
    chapter,
  }
}

function keyOf(request: ChapterRequest): string {
  const { translationId, bookId, chapter, sha256 } = request
  return `${translationId}|${bookId}|${chapter}|${sha256}`
}

export function createChapterRepository(
  sources: ChapterSources,
): ChapterRepository {
  const inflight = new Map<string, Promise<ChapterResolution>>()
  const bundled = new Map<UsfmBookId, BookText>()
  // No network module ships, so the last answer is the online signal.
  let networkAnswered = false

  async function bundledBook(bookId: UsfmBookId): Promise<BookText | null> {
    const known = bundled.get(bookId)
    if (known) return known
    const result = await sources.loadBundledBook(bookId)
    if (result.status !== "ok") return null
    bundled.set(bookId, result.value)
    for (const oldest of bundled.keys()) {
      if (bundled.size <= BUNDLED_MEMO_SIZE) break
      bundled.delete(oldest)
    }
    return result.value
  }

  async function read(request: ChapterRequest): Promise<ChapterResolution> {
    const { translationId, bookId, chapter } = request
    if (translationId === BSB_TRANSLATION_ID) {
      const book = await bundledBook(bookId)
      const text = book && chapterOf(book, chapter)
      if (text) return resolved(text, "bundled")
    }

    const downloaded = await sources.downloads.readBook(translationId, bookId)
    const fromDownload = downloaded && chapterOf(downloaded, chapter)
    if (fromDownload) return resolved(fromDownload, "downloaded")

    const kept = await sources.cache.read(request)
    if (kept && !kept.stale) return resolved(kept.text, "kept")

    const fetched = await sources.fetchChapter({
      translationId,
      bookId,
      chapter,
    })
    networkAnswered =
      fetched.status === "ok" ||
      (fetched.reason !== "offline" && fetched.reason !== "timeout")
    if (fetched.status === "ok") {
      sources.cache.write(request, fetched.text)
      return resolved(fetched.text, "network")
    }
    // An older text of the same chapter is better than R31's message.
    if (kept) return resolved(kept.text, "kept", true)
    return fetched
  }

  function resolve(request: ChapterRequest): Promise<ChapterResolution> {
    const key = keyOf(request)
    const known = inflight.get(key)
    if (known) return known
    const flight = read(request).catch(() => chapterFailure("unavailable"))
    inflight.set(key, flight)
    // Identity check: a later flight for the same key keeps its own slot.
    const release = () => {
      if (inflight.get(key) === flight) inflight.delete(key)
    }
    void flight.then(release, release)
    return flight
  }

  function translationHasBook(
    translation: CatalogTranslation,
    bookId: UsfmBookId,
  ): boolean {
    const state = sources.downloads.getState(translation.id)
    return state.kind === "downloaded"
      ? state.books.has(bookId)
      : translation.books.has(bookId)
  }

  return {
    resolve,

    createView() {
      let shown: string | null = null
      return {
        async show(request) {
          const key = keyOf(request)
          shown = key
          const result = await resolve(request)
          return shown === key ? result : SUPERSEDED
        },
      }
    },

    prefetch(request) {
      if (!networkAnswered || request.translationId === BSB_TRANSLATION_ID) {
        return
      }
      const state = sources.downloads.getState(request.translationId)
      if (state.kind === "downloaded" && state.books.has(request.bookId)) {
        return
      }
      void resolve(request)
    },

    async isOnDevice(request) {
      if (request.translationId === BSB_TRANSLATION_ID) return true
      try {
        await sources.downloads.check()
      } catch {
        // The state below then reads as not downloaded.
      }
      const state = sources.downloads.getState(request.translationId)
      if (state.kind === "downloaded" && state.books.has(request.bookId)) {
        return true
      }
      return sources.cache.has(request)
    },

    translationHasBook,
  }
}

/** Which rule chose the translation shown for a book (R25). */
export type BookTranslationChoice = "preferred" | "fallback" | "bsb"

export type BookTranslationPick = {
  translation: CatalogTranslation
  /** Anything but `preferred` shows the visible fallback label. */
  choice: BookTranslationChoice
}

export type PickTranslationInput = {
  catalog: Catalog
  bookId: UsfmBookId
  /** The viewer's translation. */
  preferredId: string
  /** The phone language's default translation (U5 computes it). */
  fallbackId?: string | null
  /** Pass `repository.translationHasBook`; the default reads the catalog. */
  hasBook?: (translation: CatalogTranslation, bookId: UsfmBookId) => boolean
}

export function catalogHasBook(
  translation: CatalogTranslation,
  bookId: UsfmBookId,
): boolean {
  return translation.books.has(bookId)
}

// R25: the viewer's translation if it has the book, else the phone language's
// default if that has it, else BSB. Null only for a catalog with no BSB,
// which U3's build check refuses.
export function pickTranslationForBook(
  input: PickTranslationInput,
): BookTranslationPick | null {
  const hasBook = input.hasBook ?? catalogHasBook
  const candidates: [string | null | undefined, BookTranslationChoice][] = [
    [input.preferredId, "preferred"],
    [input.fallbackId, "fallback"],
  ]
  for (const [id, choice] of candidates) {
    const translation = id ? input.catalog.byId.get(id) : undefined
    if (translation && hasBook(translation, input.bookId)) {
      return { translation, choice }
    }
  }
  const bsb = input.catalog.byId.get(BSB_TRANSLATION_ID)
  return bsb ? { translation: bsb, choice: "bsb" } : null
}

/** A BSB reference in a translation's own numbering (R38, U2). */
export function toTranslationRef(
  ref: VerseRef,
  translationId: string,
): VerseRef {
  return fromBsb(ref, translationBookSystem(translationId, ref.book))
}

/** A translation's reference back in BSB numbering, for storage (R38). */
export function toBsbRef(ref: VerseRef, translationId: string): VerseRef {
  return toBsb(ref, translationBookSystem(translationId, ref.book))
}
