// The cache and the download store are real, on jest-expo's in-memory
// expo-file-system. The bundled loader and the network are fakes, so each
// test can see which source answered.
import { Directory, File, Paths } from "expo-file-system"

import type { BundledResult } from "../../data/bundled"
import type { Catalog, CatalogTranslation } from "../../data/catalog"
import type { UsfmBookId } from "../../text/books"
import { normalizeChapterFile } from "../../text/normalize"
import type { BookText, ChapterText } from "../../text/types"
import { createChapterCache, type ChapterCache } from "../chapterCache"
import type { ChapterAddress, ChapterFetchResult } from "../fetchChapter"
import {
  createChapterRepository,
  pickTranslationForBook,
  toTranslationRef,
  type ChapterRequest,
} from "../resolveChapter"
import {
  createTranslationDownloads,
  type DownloadPort,
  type TranslationDownloads,
} from "../translationDownloads"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

function fixture(name: string): string {
  return fs.readFileSync(`${__dirname}/fixtures/${name}`, "utf8")
}

function chapterFile(name: string): ChapterText {
  const result = normalizeChapterFile(JSON.parse(fixture(name)))
  if (result.status !== "ok") throw new Error(result.reason)
  return result.value
}

const JOHN_3 = chapterFile("gue_wbt-JHN-3.json")
const RUTH_2 = chapterFile("gue_wbt-RUT-2.json")
const COMPLETE = fixture("gue_wbt-complete.json")

const SHA_GUE =
  "34648b0ce0a6556760ba9daa66eac03c198e897cb0822f7663d6e43391f5ce09"
const SHA_NEW = "c".repeat(64)

function translation(
  id: string,
  books: UsfmBookId[] | "all",
  extra: Partial<CatalogTranslation> = {},
): CatalogTranslation {
  return {
    id,
    language: "und",
    languageName: id,
    languageEnglishName: id,
    name: id,
    englishName: id,
    shortName: id,
    textDirection: "ltr",
    complete: books === "all",
    credit: "credit",
    sha256: SHA_GUE,
    downloadBytes: 30454,
    books: new Set(books === "all" ? [] : books),
    ...extra,
  }
}

const GUE = translation("gue_wbt", ["RUT", "PRO", "LUK", "JHN", "ACT"])
const ALL_BOOKS = { has: () => true } as unknown as ReadonlySet<UsfmBookId>
const RUS = { ...translation("rus_syn", "all"), books: ALL_BOOKS }
const BSB = { ...translation("BSB", "all"), books: ALL_BOOKS }

function catalogOf(...entries: CatalogTranslation[]): Catalog {
  return {
    translations: entries,
    byId: new Map(entries.map((entry) => [entry.id, entry])),
  }
}

function request(text: ChapterText, sha256 = SHA_GUE): ChapterRequest {
  return {
    translationId: text.translationId,
    bookId: text.bookId,
    chapter: text.chapter.number,
    sha256,
  }
}

/** A stand-in for one bundled BSB book; bundled.test.ts reads the real one. */
const BSB_JOHN: BookText = {
  formatVersion: JOHN_3.formatVersion,
  translationId: "BSB",
  bookId: "JHN",
  bookName: "John",
  textDirection: "ltr",
  chapters: [JOHN_3.chapter],
}

const completePort: DownloadPort = async (request) => {
  new File(request.destinationUri).write(COMPLETE)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const OFFLINE: ChapterFetchResult = { status: "failed", reason: "offline" }

type Harness = {
  cache: ChapterCache
  downloads: TranslationDownloads
  fetchChapter: jest.Mock<Promise<ChapterFetchResult>, [ChapterAddress]>
  loadBundledBook: jest.Mock<Promise<BundledResult<BookText>>, [UsfmBookId]>
}

function harness(): Harness {
  return {
    cache: createChapterCache(),
    downloads: createTranslationDownloads({ port: completePort }),
    fetchChapter: jest.fn<Promise<ChapterFetchResult>, [ChapterAddress]>(
      async () => OFFLINE,
    ),
    loadBundledBook: jest.fn(async (bookId: UsfmBookId) =>
      bookId === "JHN"
        ? { status: "ok" as const, value: BSB_JOHN }
        : { status: "failed" as const, reason: "asset-unavailable" as const },
    ),
  }
}

function repositoryOf(parts: Harness) {
  return createChapterRepository(parts)
}

beforeEach(() => {
  for (const root of [Paths.document, Paths.cache]) {
    const bible = new Directory(root, "bible")
    if (bible.exists) bible.delete()
  }
})

describe("chapter source order", () => {
  it("resolves a BSB chapter from the bundled asset with no network call", async () => {
    const parts = harness()
    const repository = repositoryOf(parts)

    const result = await repository.resolve({
      translationId: "BSB",
      bookId: "JHN",
      chapter: 3,
      sha256: SHA_GUE,
    })

    if (result.status !== "ok") throw new Error(result.reason)
    expect(result.source).toBe("bundled")
    expect(result.text.translationId).toBe("BSB")
    expect(result.text.chapter.number).toBe(3)
    expect(parts.loadBundledBook).toHaveBeenCalledWith("JHN")
    expect(parts.fetchChapter).not.toHaveBeenCalled()
  })

  it("reads a bundled book once for two reads", async () => {
    const parts = harness()
    const repository = repositoryOf(parts)
    const bsb = { translationId: "BSB", bookId: "JHN", chapter: 3 } as const

    await repository.resolve({ ...bsb, sha256: SHA_GUE })
    await repository.resolve({ ...bsb, sha256: SHA_GUE })

    expect(parts.loadBundledBook).toHaveBeenCalledTimes(1)
  })

  it("fetches a BSB chapter when the bundled book fails to load", async () => {
    const parts = harness()
    const bsbRuth = { ...RUTH_2, translationId: "BSB" }
    parts.fetchChapter.mockResolvedValue({ status: "ok", text: bsbRuth })

    const result = await repositoryOf(parts).resolve(request(bsbRuth))

    expect(result.status === "ok" && result.source).toBe("network")
  })

  it("resolves a downloaded translation from its book file with no network call", async () => {
    const parts = harness()
    await parts.downloads.start(GUE)

    const result = await repositoryOf(parts).resolve(request(JOHN_3))

    if (result.status !== "ok") throw new Error(result.reason)
    expect(result.source).toBe("downloaded")
    expect(result.text).toEqual(JOHN_3)
    expect(parts.fetchChapter).not.toHaveBeenCalled()
  })

  it("covers AE5: a kept chapter shows offline", async () => {
    const parts = harness()
    parts.cache.write(request(JOHN_3), JOHN_3)

    const result = await repositoryOf(parts).resolve(request(JOHN_3))

    expect(result).toEqual({
      status: "ok",
      text: JOHN_3,
      source: "kept",
      stale: false,
    })
    expect(parts.fetchChapter).not.toHaveBeenCalled()
  })

  it("covers AE5: an unread chapter offline returns the offline error", async () => {
    const parts = harness()

    await expect(repositoryOf(parts).resolve(request(JOHN_3))).resolves.toEqual(
      { status: "failed", reason: "offline" },
    )
  })

  it("fetches an unread chapter online and keeps it", async () => {
    const parts = harness()
    parts.fetchChapter.mockResolvedValue({ status: "ok", text: JOHN_3 })
    const repository = repositoryOf(parts)

    const first = await repository.resolve(request(JOHN_3))
    const second = await repository.resolve(request(JOHN_3))

    expect(first.status === "ok" && first.source).toBe("network")
    expect(second.status === "ok" && second.source).toBe("kept")
    expect(parts.fetchChapter).toHaveBeenCalledTimes(1)
    expect(parts.fetchChapter).toHaveBeenCalledWith({
      translationId: "gue_wbt",
      bookId: "JHN",
      chapter: 3,
    })
  })

  it("refetches a chapter kept under an older catalog sha256", async () => {
    const parts = harness()
    parts.cache.write(request(JOHN_3, SHA_GUE), JOHN_3)
    parts.fetchChapter.mockResolvedValue({ status: "ok", text: JOHN_3 })

    const result = await repositoryOf(parts).resolve(request(JOHN_3, SHA_NEW))

    expect(result.status === "ok" && result.source).toBe("network")
    expect(parts.fetchChapter).toHaveBeenCalledTimes(1)
    await expect(
      parts.cache.read(request(JOHN_3, SHA_NEW)),
    ).resolves.toMatchObject({ stale: false })
  })

  it("shows the stale kept chapter when the refetch fails", async () => {
    const parts = harness()
    parts.cache.write(request(JOHN_3, SHA_GUE), JOHN_3)

    const result = await repositoryOf(parts).resolve(request(JOHN_3, SHA_NEW))

    expect(result).toEqual({
      status: "ok",
      text: JOHN_3,
      source: "kept",
      stale: true,
    })
  })

  it("passes a fetch failure through as a typed reason", async () => {
    const parts = harness()
    parts.fetchChapter.mockResolvedValue({
      status: "failed",
      reason: "not-found",
      httpStatus: 404,
    })

    await expect(repositoryOf(parts).resolve(request(JOHN_3))).resolves.toEqual(
      {
        status: "failed",
        reason: "not-found",
        httpStatus: 404,
      },
    )
  })

  it("returns a typed failure when a source throws", async () => {
    const parts = harness()
    parts.downloads.readBook = () => Promise.reject(new Error("disk"))

    await expect(repositoryOf(parts).resolve(request(JOHN_3))).resolves.toEqual(
      { status: "failed", reason: "unavailable" },
    )
  })
})

describe("the chapter the reader shows", () => {
  it("drops a late response for a chapter the reader left", async () => {
    const parts = harness()
    const late = deferred<ChapterFetchResult>()
    parts.fetchChapter.mockImplementation(async (address) =>
      address.bookId === "JHN" ? late.promise : { status: "ok", text: RUTH_2 },
    )
    const repository = repositoryOf(parts)
    const view = repository.createView()

    const left = view.show(request(JOHN_3))
    const current = await view.show(request(RUTH_2))
    late.resolve({ status: "ok", text: JOHN_3 })

    expect(current.status === "ok" && current.text).toEqual(RUTH_2)
    await expect(left).resolves.toEqual({ status: "superseded" })
    // The late chapter is still kept for the viewer's next visit.
    expect(parts.cache.has(request(JOHN_3))).toBe(true)
  })

  it("keeps two readers apart", async () => {
    const parts = harness()
    parts.fetchChapter.mockImplementation(async (address) => ({
      status: "ok",
      text: address.bookId === "JHN" ? JOHN_3 : RUTH_2,
    }))
    const repository = repositoryOf(parts)
    const tab = repository.createView()
    const pushed = repository.createView()

    const [fromTab, fromPushed] = await Promise.all([
      tab.show(request(JOHN_3)),
      pushed.show(request(RUTH_2)),
    ])

    expect(fromTab.status).toBe("ok")
    expect(fromPushed.status).toBe("ok")
  })

  it("joins a prefetch and a show of one chapter into one fetch", async () => {
    const parts = harness()
    parts.fetchChapter.mockResolvedValue({ status: "ok", text: RUTH_2 })
    const repository = repositoryOf(parts)
    await repository.resolve(request(RUTH_2))
    parts.fetchChapter.mockClear()
    const next = deferred<ChapterFetchResult>()
    parts.fetchChapter.mockReturnValue(next.promise)

    repository.prefetch(request(JOHN_3))
    const shown = repository.createView().show(request(JOHN_3))
    next.resolve({ status: "ok", text: JOHN_3 })

    expect((await shown).status).toBe("ok")
    expect(parts.fetchChapter).toHaveBeenCalledTimes(1)
  })

  it("prefetches only after the network answered", async () => {
    const parts = harness()
    const repository = repositoryOf(parts)

    repository.prefetch(request(JOHN_3))
    expect(parts.fetchChapter).not.toHaveBeenCalled()

    parts.fetchChapter.mockResolvedValue({ status: "ok", text: RUTH_2 })
    await repository.resolve(request(RUTH_2))
    parts.fetchChapter.mockResolvedValue({ status: "ok", text: JOHN_3 })
    repository.prefetch(request(JOHN_3))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(parts.fetchChapter).toHaveBeenCalledTimes(2)
    expect(parts.cache.has(request(JOHN_3))).toBe(true)

    parts.fetchChapter.mockResolvedValue(OFFLINE)
    await repository.resolve(request(JOHN_3, SHA_NEW))
    repository.prefetch({ ...request(JOHN_3), chapter: 4 })
    expect(parts.fetchChapter).toHaveBeenCalledTimes(3)
  })
})

describe("is the chapter on the device (R41)", () => {
  it("answers for BSB, a download, a kept chapter, and neither", async () => {
    const parts = harness()
    await parts.downloads.start(GUE)
    const russianRuth = { ...RUTH_2, translationId: "rus_syn" }
    expect(parts.cache.write(request(russianRuth), russianRuth)).toBe(true)
    const repository = repositoryOf(parts)

    await expect(
      repository.isOnDevice({ ...request(JOHN_3), translationId: "BSB" }),
    ).resolves.toBe(true)
    await expect(repository.isOnDevice(request(JOHN_3))).resolves.toBe(true)
    await expect(
      repository.isOnDevice({ ...request(JOHN_3), bookId: "GEN" }),
    ).resolves.toBe(false)
    await expect(
      repository.isOnDevice({ ...request(RUTH_2), translationId: "rus_syn" }),
    ).resolves.toBe(true)
    await expect(
      repository.isOnDevice({ ...request(JOHN_3), translationId: "rus_syn" }),
    ).resolves.toBe(false)
    expect(parts.fetchChapter).not.toHaveBeenCalled()
  })
})

describe("R25: the translation shown for a book", () => {
  const PARTIAL = translation("xyz_nt", ["MAT", "JHN"])
  const catalog = catalogOf(GUE, RUS, PARTIAL, BSB)

  it("keeps the chosen translation when it has the book", () => {
    expect(
      pickTranslationForBook({
        catalog,
        bookId: "JHN",
        preferredId: "gue_wbt",
        fallbackId: "rus_syn",
      }),
    ).toEqual({ translation: GUE, choice: "preferred" })
  })

  it("uses the phone language's default when that has the book", () => {
    expect(
      pickTranslationForBook({
        catalog,
        bookId: "GEN",
        preferredId: "gue_wbt",
        fallbackId: "rus_syn",
      }),
    ).toEqual({ translation: RUS, choice: "fallback" })
  })

  it("uses BSB when the default lacks the book too, or is unknown", () => {
    for (const fallbackId of ["xyz_nt", "no_such", null]) {
      expect(
        pickTranslationForBook({
          catalog,
          bookId: "GEN",
          preferredId: "gue_wbt",
          fallbackId,
        }),
      ).toEqual({ translation: BSB, choice: "bsb" })
    }
  })

  it("treats a chosen translation that left the catalog as missing", () => {
    expect(
      pickTranslationForBook({
        catalog,
        bookId: "JHN",
        preferredId: "gone_id",
        fallbackId: "rus_syn",
      }),
    ).toEqual({ translation: RUS, choice: "fallback" })
  })

  it("reads a downloaded translation's books from its manifest", async () => {
    const parts = harness()
    const complete = JSON.parse(COMPLETE) as { books: { id: string }[] }
    complete.books = complete.books.filter((book) => book.id !== "ACT")
    parts.downloads = createTranslationDownloads({
      port: async (request) => {
        new File(request.destinationUri).write(JSON.stringify(complete))
      },
    })
    await parts.downloads.start(GUE)
    const repository = repositoryOf(parts)

    // The catalog lists ACT, but the downloaded file did not hold it.
    expect(GUE.books.has("ACT")).toBe(true)
    expect(repository.translationHasBook(GUE, "ACT")).toBe(false)
    expect(repository.translationHasBook(GUE, "JHN")).toBe(true)
    expect(
      pickTranslationForBook({
        catalog,
        bookId: "ACT",
        preferredId: "gue_wbt",
        fallbackId: "rus_syn",
        hasBook: repository.translationHasBook,
      }),
    ).toEqual({ translation: RUS, choice: "fallback" })
  })

  it("converts a BSB reference to the picked translation's numbering (R38)", () => {
    const pick = pickTranslationForBook({
      catalog,
      bookId: "PSA",
      preferredId: "rus_syn",
    })

    expect(pick?.choice).toBe("preferred")
    expect(
      toTranslationRef(
        { book: "PSA", chapter: 23, verse: 1 },
        pick?.translation.id ?? "",
      ),
    ).toEqual({ book: "PSA", chapter: 22, verse: 1 })
    expect(
      toTranslationRef({ book: "JHN", chapter: 3, verse: 16 }, "BSB"),
    ).toEqual({ book: "JHN", chapter: 3, verse: 16 })
  })
})
