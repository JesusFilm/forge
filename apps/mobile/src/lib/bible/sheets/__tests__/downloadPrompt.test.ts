/**
 * The top bar's download button (feat-553 U10, R29, R30): a confirmation
 * that shows the catalog size before anything starts, then cancel, retry,
 * update, and remove. BSB never offers a download.
 */
jest.mock("../../../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { datadogLog } from "../../../datadog"
import { parseCatalog, type Catalog } from "../../data/catalog"
import type {
  DownloadOutcome,
  TranslationDownloadState,
} from "../../repository/translationDownloads"
import { READER_SHEET_COPY } from "../copy"
import {
  downloadPrompt,
  formatDownloadSize,
  presentReaderDownloadPrompt,
  type DownloadPromptAlert,
  type DownloadPromptDownloads,
} from "../downloadPrompt"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(
    fs.readFileSync(
      `${__dirname}/../../../../../assets/bible/catalog.bible`,
      "utf8",
    ),
  )
  const catalog = parseCatalog(raw)
  if (!catalog) throw new Error("the bundled catalog did not parse")
  return catalog
}

const CATALOG = loadCatalog()
const SYNODAL = CATALOG.byId.get("rus_syn")!
const BSB = CATALOG.byId.get("BSB")!
const COPY = READER_SHEET_COPY.download

type AlertCall = {
  title: string
  message: string
  buttons: { text: string; style?: string; onPress?: () => void }[]
}

function harness(
  state: TranslationDownloadState,
  runningId: string | null = null,
) {
  const calls: AlertCall[] = []
  const alert: DownloadPromptAlert = (title, message, buttons) => {
    calls.push({ title, message, buttons })
  }
  const outcome: DownloadOutcome = { status: "downloaded" }
  const downloads = {
    check: jest.fn(() => Promise.resolve()),
    getState: jest.fn(() => state),
    runningId: jest.fn(() => runningId),
    start: jest.fn(() => Promise.resolve(outcome)),
    cancel: jest.fn(),
    remove: jest.fn(() => Promise.resolve()),
  } satisfies DownloadPromptDownloads
  return { calls, alert, downloads }
}

function press(call: AlertCall | undefined, text: string): void {
  const button = call?.buttons.find((candidate) => candidate.text === text)
  if (!button) throw new Error(`no "${text}" button`)
  button.onPress?.()
}

function labels(call: AlertCall | undefined): string[] {
  return (call?.buttons ?? []).map((button) => button.text)
}

describe("formatDownloadSize", () => {
  it("shows megabytes with one decimal", () => {
    expect(formatDownloadSize(5_722_365)).toBe("5.5 MB")
  })
})

describe("presentReaderDownloadPrompt", () => {
  it("shows the catalog size before a download starts", async () => {
    const { calls, alert, downloads } = harness({ kind: "not-downloaded" })
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    expect(downloads.check).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.title).toBe(COPY.startTitle(SYNODAL.name))
    expect(calls[0]?.message).toContain(
      formatDownloadSize(SYNODAL.downloadBytes),
    )
    expect(downloads.start).not.toHaveBeenCalled()

    press(calls[0], COPY.start)
    expect(downloads.start).toHaveBeenCalledWith(SYNODAL)
  })

  it("starts nothing when the viewer says no", async () => {
    const { calls, alert, downloads } = harness({ kind: "not-downloaded" })
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    press(calls[0], COPY.cancel)
    expect(downloads.start).not.toHaveBeenCalled()
    expect(downloads.cancel).not.toHaveBeenCalled()
  })

  it("lets the viewer cancel a running download", async () => {
    const { calls, alert, downloads } = harness({
      kind: "downloading",
      phase: "transfer",
      percent: 45,
      bytesWritten: 45,
      totalBytes: 100,
    })
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    expect(calls[0]?.message).toContain("45%")
    press(calls[0], COPY.keepGoing)
    expect(downloads.cancel).not.toHaveBeenCalled()
    press(calls[0], COPY.stop)
    expect(downloads.cancel).toHaveBeenCalledWith("rus_syn")
    expect(downloads.start).not.toHaveBeenCalled()
  })

  it("offers a retry after a download stops", async () => {
    const { calls, alert, downloads } = harness({
      kind: "failed",
      reason: "network",
    })
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    expect(calls[0]?.title).toBe(COPY.failedTitle(SYNODAL.name))
    press(calls[0], COPY.retry)
    expect(downloads.start).toHaveBeenCalledWith(SYNODAL)
  })

  it("offers no retry for a translation that is too large", async () => {
    const { calls, alert, downloads } = harness({
      kind: "failed",
      reason: "too-large",
    })
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    expect(labels(calls[0])).toEqual([COPY.ok])
  })

  it("lets the viewer remove a downloaded translation", async () => {
    const { calls, alert, downloads } = harness({
      kind: "downloaded",
      sha256: SYNODAL.sha256,
      books: SYNODAL.books,
      bytes: 7_340_032,
    })
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    expect(calls[0]?.message).toContain("7.0 MB")
    expect(labels(calls[0])).toEqual([READER_SHEET_COPY.close, COPY.remove])
    press(calls[0], COPY.remove)
    expect(downloads.remove).toHaveBeenCalledWith("rus_syn")
    expect(downloads.start).not.toHaveBeenCalled()
  })

  it("offers the update again when the kept copy is old", async () => {
    const { calls, alert, downloads } = harness({
      kind: "downloaded",
      sha256: "0".repeat(64),
      books: SYNODAL.books,
      bytes: 100,
    })
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    expect(calls[0]?.title).toBe(COPY.updateTitle(SYNODAL.name))
    expect(labels(calls[0])).toEqual([
      READER_SHEET_COPY.close,
      COPY.remove,
      COPY.update,
    ])
    press(calls[0], COPY.update)
    expect(downloads.start).toHaveBeenCalledWith(SYNODAL)
  })

  it("never offers a download of BSB", async () => {
    const { calls, alert, downloads } = harness({ kind: "bundled" })
    await presentReaderDownloadPrompt(
      { translation: BSB },
      { downloads, alert },
    )
    expect(calls[0]?.title).toBe(COPY.bundledTitle(BSB.name))
    expect(labels(calls[0])).toEqual([COPY.ok])
    press(calls[0], COPY.ok)
    expect(downloads.start).not.toHaveBeenCalled()
    expect(downloads.remove).not.toHaveBeenCalled()
  })

  it("treats BSB as bundled even when a state says otherwise", () => {
    const prompt = downloadPrompt({
      translation: BSB,
      state: { kind: "not-downloaded" },
      runningId: null,
    })
    expect(prompt.buttons.map((button) => button.action)).toEqual(["dismiss"])
  })

  it("asks the viewer to wait while another translation downloads", async () => {
    const { calls, alert, downloads } = harness(
      { kind: "not-downloaded" },
      "spa_r09",
    )
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    expect(calls[0]?.title).toBe(COPY.busyTitle)
    expect(labels(calls[0])).toEqual([COPY.ok])
  })

  it("shows nothing before the reader knows its translation", async () => {
    const { calls, alert, downloads } = harness({ kind: "not-downloaded" })
    await presentReaderDownloadPrompt(
      { translation: null },
      { downloads, alert },
    )
    expect(calls).toHaveLength(0)
    expect(downloads.check).not.toHaveBeenCalled()
  })

  it("still prompts when the device check fails", async () => {
    const { calls, alert, downloads } = harness({ kind: "not-downloaded" })
    downloads.check.mockImplementationOnce(() =>
      Promise.reject(new Error("disk")),
    )
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    expect(calls).toHaveLength(1)
  })
})

// U14, R37: a started download logs its outcome once, when it ends.
describe("the bible_reader.download event", () => {
  const info = datadogLog.info as unknown as jest.Mock

  beforeEach(() => info.mockClear())

  async function startWith(outcome: DownloadOutcome) {
    const { calls, alert, downloads } = harness({ kind: "not-downloaded" })
    // The harness types `start` from its own "downloaded" outcome.
    ;(
      downloads.start as jest.Mock<Promise<DownloadOutcome>>
    ).mockImplementation(() => Promise.resolve(outcome))
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    press(calls[0], COPY.start)
    // Nothing logs before the download ends.
    expect(info).not.toHaveBeenCalled()
    await Promise.resolve()
    await Promise.resolve()
    return info.mock.calls
  }

  it.each([
    [{ status: "downloaded" } as const, "none"],
    [{ status: "cancelled" } as const, "none"],
    [{ status: "failed", reason: "no-space" } as const, "no-space"],
  ])(
    "logs %o with its reason and the catalog bytes",
    async (outcome, reason) => {
      expect(await startWith(outcome)).toEqual([
        [
          "bible_reader.download",
          {
            reader_translation_id: "rus_syn",
            reader_outcome: outcome.status,
            reader_reason: reason,
            reader_download_bytes: SYNODAL.downloadBytes,
          },
        ],
      ])
    },
  )

  it("logs nothing for a cancel or a remove, which start no download", async () => {
    const { calls, alert, downloads } = harness({
      kind: "downloaded",
      sha256: SYNODAL.sha256,
      books: SYNODAL.books,
      bytes: SYNODAL.downloadBytes,
    })
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    press(calls[0], COPY.remove)
    await Promise.resolve()
    expect(info).not.toHaveBeenCalled()
  })

  it("logs nothing when the start itself rejects", async () => {
    const { calls, alert, downloads } = harness({ kind: "not-downloaded" })
    downloads.start.mockImplementation(() => Promise.reject(new Error("x")))
    await presentReaderDownloadPrompt(
      { translation: SYNODAL },
      { downloads, alert },
    )
    press(calls[0], COPY.start)
    await Promise.resolve()
    await Promise.resolve()
    expect(info).not.toHaveBeenCalled()
  })
})
