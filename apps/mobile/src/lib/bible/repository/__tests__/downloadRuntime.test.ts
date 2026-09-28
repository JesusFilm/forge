// Wiring only, through jest-expo's `File.downloadFileAsync` mock. The mock
// writes placeholder bytes and sends one 100% event, so it proves the binding;
// translationDownloads.test.ts proves the split, the progress, and the cleanup.
import { Directory, File, Paths } from "expo-file-system"

import { datadogLog } from "../../../datadog"
import type { CatalogTranslation } from "../../data/catalog"
import {
  getBookNamesStore,
  getChapterRepository,
  getTranslationDownloads,
  resetBibleRepositoryForTests,
} from "../downloadRuntime"
import { storedBookNamesText } from "../bookNames"
import { CHAPTER_FETCH_TIMEOUT_MS } from "../fetchChapter"
import {
  bookNamesDirectory,
  ensureDirectory,
  stagingDirectory,
  translationsDirectory,
} from "../storage"
import type { TranslationDownloadState } from "../translationDownloads"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

type MockAsset = { downloadAsync: () => Promise<{ localUri: string | null }> }
const mockFromModule = jest.fn<MockAsset, [number]>()

jest.mock("expo-asset", () => ({
  Asset: { fromModule: (id: number) => mockFromModule(id) },
}))
jest.mock("../../../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const GUE: CatalogTranslation = {
  id: "gue_wbt",
  language: "gue",
  languageName: "Gurindji",
  languageEnglishName: "Gurindji",
  name: "Ruth + selections",
  englishName: "Gurindji Scripture Portions",
  shortName: "WBT",
  textDirection: "ltr",
  complete: false,
  credit: "Copyright © 1984 Wycliffe Bible Translators, Inc.",
  sha256: "34648b0ce0a6556760ba9daa66eac03c198e897cb0822f7663d6e43391f5ce09",
  downloadBytes: 30454,
  books: new Set(["RUT", "PRO", "LUK", "JHN", "ACT"]),
}

const originalFetch = globalThis.fetch

beforeEach(() => {
  resetBibleRepositoryForTests()
  mockFromModule.mockReset()
  for (const root of [Paths.document, Paths.cache]) {
    const bible = new Directory(root, "bible")
    if (bible.exists) bible.delete()
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  jest.restoreAllMocks()
})

describe("Bible repository runtime", () => {
  it("binds the download port to File.downloadFileAsync", async () => {
    const download = jest.spyOn(File, "downloadFileAsync")
    const downloads = getTranslationDownloads()
    await downloads.check()
    const seen: TranslationDownloadState[] = []
    downloads.subscribe(() => seen.push(downloads.getState(GUE.id)))

    const outcome = await downloads.start(GUE)

    expect(download).toHaveBeenCalledTimes(1)
    const [url, destination, options] = download.mock.calls[0] ?? []
    expect(url).toBe("https://bible.helloao.org/api/gue_wbt/complete.json")
    expect(destination).toBeInstanceOf(File)
    expect(destination?.uri).toBe(
      new File(stagingDirectory(), "gue_wbt.json").uri,
    )
    expect(options?.idempotent).toBe(true)
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    // The mock's one progress event reached the store through the native
    // event emitter. Its placeholder bytes are not a translation.
    expect(
      seen.some(
        (state) => state.kind === "downloading" && state.percent === 100,
      ),
    ).toBe(true)
    expect(outcome).toEqual({ status: "failed", reason: "invalid-data" })
    expect(new File(stagingDirectory(), "gue_wbt.json").exists).toBe(false)
    expect(
      new File(translationsDirectory(), "gue_wbt", "manifest.json").exists,
    ).toBe(false)
  })

  it("keeps one download store, so one download at a time holds app-wide", () => {
    expect(getTranslationDownloads()).toBe(getTranslationDownloads())
    expect(getChapterRepository()).toBe(getChapterRepository())
  })

  it("resolves a BSB chapter from the real bundled asset with no fetch", async () => {
    const uri = "file:///mock/bundle/assets/3JN.bible"
    const asset = new File(uri)
    asset.create({ intermediates: true, overwrite: true })
    asset.write(
      fs.readFileSync(
        `${__dirname}/../../../../../assets/bible/bsb/3JN.bible`,
        "utf8",
      ),
    )
    mockFromModule.mockReturnValue({
      downloadAsync: async () => ({ localUri: uri }),
    })
    const fetchSpy = jest.fn<Promise<Response>, [string]>()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const result = await getChapterRepository().resolve({
      translationId: "BSB",
      bookId: "3JN",
      chapter: 1,
      sha256: "0".repeat(64),
    })

    if (result.status !== "ok") throw new Error(result.reason)
    expect(result.source).toBe("bundled")
    expect(result.text.chapter.number).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fetches another translation through the global fetch and keeps it", async () => {
    const body = fs.readFileSync(
      `${__dirname}/fixtures/gue_wbt-JHN-3.json`,
      "utf8",
    )
    const fetchSpy = jest.fn(
      async (_url: string, _init: { signal: AbortSignal }) =>
        new Response(body, { status: 200 }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const request = {
      translationId: "gue_wbt",
      bookId: "JHN",
      chapter: 3,
      sha256: GUE.sha256,
    } as const

    const first = await getChapterRepository().resolve(request)

    expect(first.status === "ok" && first.source).toBe("network")
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://bible.helloao.org/api/gue_wbt/JHN/3.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    await expect(getChapterRepository().isOnDevice(request)).resolves.toBe(true)
  })

  // U14, R37: the one fetch binding reports each failed fetch. Two readers
  // that ask for one chapter at once share the fetch, so it logs once.
  it("logs one failed fetch with its typed reason, for two readers at once", async () => {
    const warn = datadogLog.warn as unknown as jest.Mock
    warn.mockClear()
    const fetchSpy = jest.fn(
      async (_url: string, _init: { signal: AbortSignal }) =>
        new Response("<html>Not found: John 3:16 For God so loved</html>", {
          status: 404,
        }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const request = {
      translationId: "gue_wbt",
      bookId: "JHN",
      chapter: 3,
      sha256: GUE.sha256,
    } as const
    const repository = getChapterRepository()

    const [tab, pushed] = await Promise.all([
      repository.createView().show(request),
      repository.createView().show(request),
    ])

    expect(tab).toEqual({
      status: "failed",
      reason: "not-found",
      httpStatus: 404,
    })
    expect(pushed).toEqual(tab)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls).toEqual([
      [
        "bible_reader.chapter_fetch_failed",
        {
          reader_translation_id: "gue_wbt",
          reader_book: "JHN",
          reader_chapter: 3,
          reader_reason: "not-found",
          reader_http_status: 404,
        },
      ],
    ])
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/html|loved/i)
  })
})

// The owner (2026-09-28): the passage picker names books as the shown
// translation does. These prove the store's file and network bindings.
describe("book names runtime", () => {
  const KEY = { id: GUE.id, sha256: GUE.sha256 }

  it("reads books.json through the global fetch, then from the device", async () => {
    const books = {
      translation: { id: GUE.id },
      books: [{ id: "RUT", name: "Ruth", commonName: "Ruth-ku" }],
    }
    const fetchSpy = jest.fn<Promise<Response>, [string]>(
      async () => new Response(JSON.stringify(books), { status: 200 }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const names = await getBookNamesStore().load(KEY)
    expect(names?.get("RUT")).toBe("Ruth-ku")
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://bible.helloao.org/api/gue_wbt/books.json",
    )
    expect(new File(bookNamesDirectory(), "gue_wbt.json").exists).toBe(true)

    // A new session reads the file, and the network is not asked again.
    resetBibleRepositoryForTests()
    const again = await getBookNamesStore().load(KEY)
    expect(again?.get("RUT")).toBe("Ruth-ku")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // No download holds names here, so the network is the only source. A failed
  // read must end in no names (the picker then shows BSB's), never a throw.
  it.each<[string, () => Promise<Response>]>([
    ["a 503", async () => new Response("", { status: 503 })],
    ["malformed JSON", async () => new Response("{books:", { status: 200 })],
    [
      "a network failure",
      async () => {
        throw new TypeError("Network request failed")
      },
    ],
  ])("gives no names and keeps no file after %s", async (_name, answer) => {
    globalThis.fetch = jest.fn(answer) as unknown as typeof fetch

    await expect(getBookNamesStore().load(KEY)).resolves.toBeNull()
    expect(new File(bookNamesDirectory(), "gue_wbt.json").exists).toBe(false)
  })

  it("gives no names when books.json never answers", async () => {
    jest.useFakeTimers()
    try {
      globalThis.fetch = jest.fn(
        () => new Promise<Response>(() => {}),
      ) as unknown as typeof fetch
      const names = getBookNamesStore().load(KEY)
      await jest.advanceTimersByTimeAsync(CHAPTER_FETCH_TIMEOUT_MS)
      await expect(names).resolves.toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  // The id names a file, so an id with path characters must touch no file:
  // `book-names/../x.json` would point at `bible/x.json`.
  it("writes and reads no file for an id with path characters", async () => {
    globalThis.fetch = jest.fn(
      async () => new Response("", { status: 503 }),
    ) as unknown as typeof fetch
    const key = { id: "../x", sha256: GUE.sha256 }
    const outside = new File(Paths.document, "bible", "x.json")

    getBookNamesStore().keep(key, new Map([["RUT", "Ruth-ku"]]))
    expect(outside.exists).toBe(false)

    // A new session: a file planted where the id points is never read.
    resetBibleRepositoryForTests()
    expect(ensureDirectory(new Directory(Paths.document, "bible"))).toBe(true)
    outside.write(storedBookNamesText(key, new Map([["RUT", "Planted"]])))
    await expect(getBookNamesStore().load(key)).resolves.toBeNull()
  })

  it("keeps a download's names, so the picker needs no network for them", async () => {
    const complete = fs.readFileSync(
      `${__dirname}/fixtures/gue_wbt-complete.json`,
      "utf8",
    )
    jest
      .spyOn(File, "downloadFileAsync")
      .mockImplementation(async (_url, destination) => {
        const file = destination as File
        file.write(complete)
        return file
      })
    const fetchSpy = jest.fn(async () => new Response("", { status: 503 }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await expect(getTranslationDownloads().start(GUE)).resolves.toEqual({
      status: "downloaded",
    })
    const names = await getBookNamesStore().load(KEY)
    expect(names?.size).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
