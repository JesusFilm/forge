// Wiring only, through jest-expo's `File.downloadFileAsync` mock. The mock
// writes placeholder bytes and sends one 100% event, so it proves the binding;
// translationDownloads.test.ts proves the split, the progress, and the cleanup.
import { Directory, File, Paths } from "expo-file-system"

import type { CatalogTranslation } from "../../data/catalog"
import {
  getChapterRepository,
  getTranslationDownloads,
  resetBibleRepositoryForTests,
} from "../downloadRuntime"
import { stagingDirectory, translationsDirectory } from "../storage"
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
})
