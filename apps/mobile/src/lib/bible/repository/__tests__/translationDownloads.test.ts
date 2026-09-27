// Downloads run through a fake port on jest-expo's in-memory expo-file-system.
// The port writes the real gue_wbt complete.json, reports progress in steps,
// and leaves a partial file when it stops, as Android can (KTD4).
import { Directory, File, Paths } from "expo-file-system"

import type { CatalogTranslation } from "../../data/catalog"
import type { UsfmBookId } from "../../text/books"
import {
  createTranslationDownloads,
  DOWNLOAD_SPACE_FACTOR,
  MAX_DOWNLOAD_BYTES,
  type DownloadPort,
  type DownloadRequest,
  type TranslationDownloadState,
} from "../translationDownloads"
import { stagingDirectory, translationsDirectory } from "../storage"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

const COMPLETE = fs.readFileSync(
  `${__dirname}/fixtures/gue_wbt-complete.json`,
  "utf8",
)
const COMPLETE_BYTES = new TextEncoder().encode(COMPLETE).byteLength
const GUE_BOOKS: UsfmBookId[] = ["RUT", "PRO", "LUK", "JHN", "ACT"]
const MIB = 1024 * 1024

/** The real catalog entry for gue_wbt (assets/bible/catalog.bible). */
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
  books: new Set(GUE_BOOKS),
}

const BSB: CatalogTranslation = {
  ...GUE,
  id: "BSB",
  downloadBytes: 8142601,
  books: new Set(),
}

type PortScript = {
  /** `bytesWritten` values, in order. */
  steps?: number[]
  totalBytes?: number
  /** How the transfer ends when nothing aborts it. */
  end?: "complete" | "fail" | "hold"
  body?: string
  gate?: Promise<void>
}

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), {
    name: "AbortError",
  })
}

function fakePort(script: PortScript = {}): {
  port: DownloadPort
  requests: DownloadRequest[]
  emitted: number[]
} {
  const requests: DownloadRequest[] = []
  const emitted: number[] = []
  const port: DownloadPort = async (request) => {
    requests.push(request)
    const destination = new File(request.destinationUri)
    for (const bytesWritten of script.steps ?? []) {
      if (request.signal.aborted) break
      destination.write(`partial:${bytesWritten}`)
      emitted.push(bytesWritten)
      request.onProgress({
        bytesWritten,
        totalBytes: script.totalBytes ?? -1,
      })
      await Promise.resolve()
    }
    if (script.end === "hold" && !request.signal.aborted) {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => resolve(), {
          once: true,
        })
      })
    }
    if (script.gate) await script.gate
    // The partial file stays behind, as the package docs say it may.
    if (request.signal.aborted) throw abortError()
    if (script.end === "fail") throw new TypeError("Network request failed")
    destination.write(script.body ?? COMPLETE)
  }
  return { port, requests, emitted }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function translationFolder(id = GUE.id): Directory {
  return new Directory(translationsDirectory(), id)
}

function manifestFile(id = GUE.id): File {
  return new File(translationsDirectory(), id, "manifest.json")
}

function rawFile(id = GUE.id): File {
  return new File(stagingDirectory(), `${id}.json`)
}

function kinds(states: TranslationDownloadState[]): string[] {
  return states.map((state) =>
    state.kind === "downloading"
      ? `${state.phase}:${state.percent}`
      : state.kind,
  )
}

beforeEach(() => {
  for (const root of [Paths.document, Paths.cache]) {
    const bible = new Directory(root, "bible")
    if (bible.exists) bible.delete()
  }
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("translation downloads", () => {
  it("writes one file per book, then the manifest last", async () => {
    const written: string[] = []
    const write = File.prototype.write
    jest.spyOn(File.prototype, "write").mockImplementation(function (
      this: File,
      ...args
    ) {
      written.push(this.uri)
      return write.apply(this, args)
    })
    const downloads = createTranslationDownloads({ port: fakePort().port })

    await expect(downloads.start(GUE)).resolves.toEqual({
      status: "downloaded",
    })

    const folder = translationFolder().uri.replace(/\/$/, "")
    const installed = written
      .filter((uri) => uri.startsWith(folder))
      .map((uri) => uri.slice(folder.length + 1))
    expect(installed).toEqual([
      ...GUE_BOOKS.map((book) => `books/${book}.json`),
      "manifest.json",
    ])
    expect(rawFile().exists).toBe(false)
    const state = downloads.getState(GUE.id)
    if (state.kind !== "downloaded") throw new Error(state.kind)
    expect([...state.books]).toEqual(GUE_BOOKS)
    expect(state.sha256).toBe(GUE.sha256)
  })

  it("asks the port for the catalog's complete.json link", async () => {
    const fake = fakePort()
    const downloads = createTranslationDownloads({ port: fake.port })

    await downloads.start(GUE)

    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]?.url).toBe(
      "https://bible.helloao.org/api/gue_wbt/complete.json",
    )
    expect(fake.requests[0]?.destinationUri).toBe(rawFile().uri)
  })

  it("reads a downloaded book back, and nothing for a book it lacks", async () => {
    const downloads = createTranslationDownloads({ port: fakePort().port })
    await downloads.start(GUE)

    const john = await downloads.readBook(GUE.id, "JHN")
    expect(john?.translationId).toBe("gue_wbt")
    expect(john?.bookId).toBe("JHN")
    expect(john?.chapters.map((chapter) => chapter.number)).toEqual([3])
    await expect(downloads.readBook(GUE.id, "GEN")).resolves.toBeNull()
    await expect(downloads.readBook("rus_syn", "JHN")).resolves.toBeNull()
  })

  it("updates the percentage as the port reports steps", async () => {
    const quarter = (q: number) => Math.ceil(COMPLETE_BYTES * q)
    const fake = fakePort({
      steps: [quarter(0.25), quarter(0.5), quarter(0.75), COMPLETE_BYTES],
      totalBytes: COMPLETE_BYTES,
    })
    const downloads = createTranslationDownloads({ port: fake.port })
    await downloads.check()
    const seen: TranslationDownloadState[] = []
    downloads.subscribe(() => seen.push(downloads.getState(GUE.id)))

    await downloads.start(GUE)

    expect(kinds(seen)).toEqual([
      "transfer:0",
      "transfer:25",
      "transfer:50",
      "transfer:75",
      "transfer:100",
      "install:100",
      "downloaded",
    ])
  })

  it("uses the catalog size when the server sends no length", async () => {
    const fake = fakePort({ steps: [GUE.downloadBytes / 2] })
    const downloads = createTranslationDownloads({ port: fake.port })
    const seen: TranslationDownloadState[] = []
    downloads.subscribe(() => seen.push(downloads.getState(GUE.id)))

    await downloads.start(GUE)

    expect(kinds(seen)).toContain("transfer:50")
  })

  it("stops a transfer that passes 32 MB and removes its partial file", async () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(32 * MIB)
    const fake = fakePort({
      steps: [8 * MIB, 16 * MIB, 24 * MIB, 32 * MIB, 40 * MIB, 48 * MIB],
    })
    const downloads = createTranslationDownloads({ port: fake.port })

    const outcome = await downloads.start(GUE)

    expect(outcome).toEqual({ status: "failed", reason: "too-large" })
    expect(fake.emitted).toEqual([8, 16, 24, 32, 40].map((n) => n * MIB))
    expect(fake.requests[0]?.signal.aborted).toBe(true)
    expect(rawFile().exists).toBe(false)
    expect(manifestFile().exists).toBe(false)
    expect(downloads.getState(GUE.id)).toEqual({
      kind: "failed",
      reason: "too-large",
    })
  })

  it("stops when the finished file passes the cap with no progress", async () => {
    const downloads = createTranslationDownloads({
      port: fakePort().port,
      maxBytes: COMPLETE_BYTES - 1,
    })

    await expect(downloads.start(GUE)).resolves.toEqual({
      status: "failed",
      reason: "too-large",
    })
    expect(rawFile().exists).toBe(false)
  })

  it("refuses a catalog size past the cap before it starts", async () => {
    const fake = fakePort()
    const downloads = createTranslationDownloads({ port: fake.port })

    const outcome = await downloads.start({
      ...GUE,
      downloadBytes: MAX_DOWNLOAD_BYTES + 1,
    })

    expect(outcome).toEqual({ status: "failed", reason: "too-large" })
    expect(fake.requests).toHaveLength(0)
  })

  it("refuses before it starts when free space is short", async () => {
    const fake = fakePort()
    let free = GUE.downloadBytes - 1
    const downloads = createTranslationDownloads({
      port: fake.port,
      availableBytes: () => free,
    })

    await expect(downloads.start(GUE)).resolves.toEqual({
      status: "failed",
      reason: "no-space",
    })
    // The raw file and the book files exist together for a moment.
    free = GUE.downloadBytes * DOWNLOAD_SPACE_FACTOR - 1
    await expect(downloads.start(GUE)).resolves.toEqual({
      status: "failed",
      reason: "no-space",
    })
    expect(fake.requests).toHaveLength(0)
    expect(downloads.getState(GUE.id)).toEqual({
      kind: "failed",
      reason: "no-space",
    })

    free = GUE.downloadBytes * DOWNLOAD_SPACE_FACTOR
    await expect(downloads.start(GUE)).resolves.toEqual({
      status: "downloaded",
    })
  })

  it("leaves no manifest when the transfer fails, and offers a retry", async () => {
    const downloads = createTranslationDownloads({
      port: fakePort({ steps: [1000], end: "fail" }).port,
    })

    await expect(downloads.start(GUE)).resolves.toEqual({
      status: "failed",
      reason: "network",
    })

    expect(manifestFile().exists).toBe(false)
    expect(rawFile().exists).toBe(false)
    expect(downloads.getState(GUE.id)).toEqual({
      kind: "failed",
      reason: "network",
    })
  })

  it("leaves no manifest and no books when a book fails to write", async () => {
    const write = File.prototype.write
    jest.spyOn(File.prototype, "write").mockImplementation(function (
      this: File,
      ...args
    ) {
      if (this.uri.endsWith("/books/LUK.json")) throw new Error("disk full")
      return write.apply(this, args)
    })
    const downloads = createTranslationDownloads({ port: fakePort().port })

    await expect(downloads.start(GUE)).resolves.toEqual({
      status: "failed",
      reason: "write-failed",
    })
    expect(translationFolder().exists).toBe(false)
    expect(rawFile().exists).toBe(false)
    expect(downloads.getState(GUE.id).kind).toBe("failed")
  })

  it("refuses a file that is not this translation", async () => {
    const notJson = createTranslationDownloads({
      port: fakePort({ body: "<html>maintenance</html>" }).port,
    })
    await expect(notJson.start(GUE)).resolves.toEqual({
      status: "failed",
      reason: "invalid-data",
    })

    const other = JSON.parse(COMPLETE) as { translation: { id: string } }
    other.translation.id = "rus_syn"
    const wrongId = createTranslationDownloads({
      port: fakePort({ body: JSON.stringify(other) }).port,
    })
    await expect(wrongId.start(GUE)).resolves.toEqual({
      status: "failed",
      reason: "invalid-data",
    })
    expect(manifestFile().exists).toBe(false)
  })

  it("a retry after a failure can succeed", async () => {
    let fail = true
    const port: DownloadPort = (request) =>
      fakePort({ end: fail ? "fail" : "complete" }).port(request)
    const downloads = createTranslationDownloads({ port })

    await downloads.start(GUE)
    expect(downloads.getState(GUE.id).kind).toBe("failed")

    fail = false
    await expect(downloads.start(GUE)).resolves.toEqual({
      status: "downloaded",
    })
    expect(downloads.getState(GUE.id).kind).toBe("downloaded")
  })

  it("cancels mid-transfer and removes the partial file", async () => {
    const fake = fakePort({ steps: [1000, 2000], end: "hold" })
    const downloads = createTranslationDownloads({ port: fake.port })

    const outcome = downloads.start(GUE)
    await flush()
    expect(downloads.getState(GUE.id).kind).toBe("downloading")
    expect(rawFile().exists).toBe(true)

    downloads.cancel(GUE.id)

    await expect(outcome).resolves.toEqual({ status: "cancelled" })
    expect(fake.requests[0]?.signal.aborted).toBe(true)
    expect(rawFile().exists).toBe(false)
    expect(manifestFile().exists).toBe(false)
    expect(downloads.getState(GUE.id)).toEqual({ kind: "not-downloaded" })
  })

  it("runs one download at a time, and the running one keeps going", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fake = fakePort({ gate })
    const downloads = createTranslationDownloads({ port: fake.port })
    const rus = { ...GUE, id: "rus_syn" }

    const first = downloads.start(GUE)
    // The viewer switches translation and asks for a second download.
    await expect(downloads.start(rus)).resolves.toEqual({
      status: "busy",
      runningId: "gue_wbt",
    })
    expect(downloads.getState("rus_syn").kind).not.toBe("downloading")
    expect(downloads.runningId()).toBe("gue_wbt")

    release()
    await expect(first).resolves.toEqual({ status: "downloaded" })
    expect(fake.requests).toHaveLength(1)
    expect(downloads.runningId()).toBeNull()
  })

  it("shows BSB as on the device and never downloads it", async () => {
    const fake = fakePort()
    const downloads = createTranslationDownloads({ port: fake.port })

    expect(downloads.getState("BSB")).toEqual({ kind: "bundled" })
    await expect(downloads.start(BSB)).resolves.toEqual({ status: "bundled" })
    expect(fake.requests).toHaveLength(0)
  })

  it("removes a downloaded translation", async () => {
    const downloads = createTranslationDownloads({ port: fakePort().port })
    await downloads.start(GUE)

    await downloads.remove(GUE.id)

    expect(translationFolder().exists).toBe(false)
    expect(downloads.getState(GUE.id)).toEqual({ kind: "not-downloaded" })
    await expect(downloads.readBook(GUE.id, "JHN")).resolves.toBeNull()
  })

  it("replaces the old download when the catalog version changes", async () => {
    const downloads = createTranslationDownloads({ port: fakePort().port })
    await downloads.start(GUE)
    const update = { ...GUE, sha256: "d".repeat(64) }

    await expect(downloads.start(update)).resolves.toEqual({
      status: "downloaded",
    })

    const state = downloads.getState(GUE.id)
    expect(state.kind === "downloaded" && state.sha256).toBe(update.sha256)
    const manifest = JSON.parse(await manifestFile().text()) as {
      sha256: string
    }
    expect(manifest.sha256).toBe(update.sha256)
  })

  it("keeps the old download readable when an update transfer fails", async () => {
    let fail = false
    const port: DownloadPort = (request) =>
      fakePort({ end: fail ? "fail" : "complete" }).port(request)
    const downloads = createTranslationDownloads({ port })
    await downloads.start(GUE)

    fail = true
    await expect(
      downloads.start({ ...GUE, sha256: "d".repeat(64) }),
    ).resolves.toEqual({ status: "failed", reason: "network" })

    // The button compares this sha256 with the catalog to offer the update.
    const state = downloads.getState(GUE.id)
    expect(state.kind === "downloaded" && state.sha256).toBe(GUE.sha256)
    await expect(downloads.readBook(GUE.id, "JHN")).resolves.not.toBeNull()
  })

  it("keeps a stable state object until something changes", async () => {
    const downloads = createTranslationDownloads({ port: fakePort().port })
    await downloads.check()

    const before = downloads.getState(GUE.id)
    expect(downloads.getState(GUE.id)).toBe(before)
    await downloads.start(GUE)
    expect(downloads.getState(GUE.id)).not.toBe(before)
  })
})

describe("download state at startup", () => {
  async function downloadThenRestart() {
    await createTranslationDownloads({ port: fakePort().port }).start(GUE)
    return createTranslationDownloads({ port: fakePort().port })
  }

  it("reads downloaded from the manifest and the files", async () => {
    const downloads = await downloadThenRestart()

    expect(downloads.getState(GUE.id)).toEqual({ kind: "checking" })
    await downloads.check()

    const state = downloads.getState(GUE.id)
    if (state.kind !== "downloaded") throw new Error(state.kind)
    expect([...state.books]).toEqual(GUE_BOOKS)
    expect(downloads.getState("rus_syn")).toEqual({ kind: "not-downloaded" })
  })

  it("reads not-downloaded when a book file is missing", async () => {
    const downloads = await downloadThenRestart()
    new File(translationFolder(), "books", "JHN.json").delete()

    await downloads.check()

    expect(downloads.getState(GUE.id)).toEqual({ kind: "not-downloaded" })
    expect(translationFolder().exists).toBe(false)
  })

  it("reads not-downloaded when a book file has another size", async () => {
    const downloads = await downloadThenRestart()
    new File(translationFolder(), "books", "RUT.json").write("{}")

    await downloads.check()

    expect(downloads.getState(GUE.id)).toEqual({ kind: "not-downloaded" })
  })

  it("reads not-downloaded for book files with no manifest", async () => {
    const downloads = await downloadThenRestart()
    manifestFile().delete()

    await downloads.check()

    expect(downloads.getState(GUE.id)).toEqual({ kind: "not-downloaded" })
    expect(translationFolder().exists).toBe(false)
  })

  it("reads not-downloaded for a manifest of another text format", async () => {
    const downloads = await downloadThenRestart()
    const manifest = JSON.parse(await manifestFile().text()) as Record<
      string,
      unknown
    >
    manifestFile().write(JSON.stringify({ ...manifest, textFormatVersion: 0 }))

    await downloads.check()

    expect(downloads.getState(GUE.id)).toEqual({ kind: "not-downloaded" })
  })

  it("removes a raw file that a stopped app left behind", async () => {
    const staging = stagingDirectory()
    staging.create({ intermediates: true, idempotent: true })
    rawFile().write("partial")
    const downloads = createTranslationDownloads({ port: fakePort().port })

    await downloads.check()

    expect(rawFile().exists).toBe(false)
  })
})
