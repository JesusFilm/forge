// The reader's chapter loading (feat-553 U7, R25, R31, R41, AE16), under
// StrictMode: every effect sees setup, cleanup, setup. U4's real repository
// runs over fake sources and the real bundled BSB text.

/* eslint-disable @typescript-eslint/no-require-imports */

// The stores bind AsyncStorage at import; every case injects its own storage.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("../../../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { StrictMode, act } from "react"

import synodalPsalm50 from "../../text/__tests__/fixtures/rus_syn-psa-50.json"
import {
  TestRenderer,
  type TestInstance,
} from "../../../../test-utils/rnTestRenderer"
import type { BundledResult } from "../../data/bundled"
import { parseCatalog, type Catalog } from "../../data/catalog"
import {
  createReadingPositionStore,
  useReadingPosition,
} from "../../position/store"
import type { ChapterCache } from "../../repository/chapterCache"
import type { ChapterFailure } from "../../repository/errors"
import type {
  ChapterAddress,
  ChapterFetchResult,
} from "../../repository/fetchChapter"
import { createChapterRepository } from "../../repository/resolveChapter"
import type { TranslationDownloadState } from "../../repository/translationDownloads"
import { createReaderSettingsStore } from "../../settings/store"
import type { UsfmBookId } from "../../text/books"
import { normalizeChapterFile, parseBookText } from "../../text/normalize"
import type { BookText, ChapterText } from "../../text/types"
import { datadogLog } from "../../../datadog"
import { resetReaderTelemetryForTests } from "../../telemetry"
import type { ReaderServices } from "../services"
import {
  nextChapterRequest,
  useReaderChapter,
  type ReaderChapter,
} from "../useReaderChapter"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

const ASSETS = `${__dirname}/../../../../../assets/bible`

function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(
    fs.readFileSync(`${ASSETS}/catalog.bible`, "utf8"),
  )
  const catalog = parseCatalog(raw)
  if (!catalog) throw new Error("the bundled catalog did not parse")
  return catalog
}

const CATALOG = loadCatalog()
const SPANISH = "spa_bes"
const OFFLINE: ChapterFailure = { status: "failed", reason: "offline" }

/** SYNTHETIC: a Spanish John chapter, so no case needs the network. */
function spanishJohn(chapter: number): ChapterText {
  return {
    formatVersion: 1,
    translationId: SPANISH,
    bookId: "JHN",
    bookName: "Juan",
    textDirection: "ltr",
    chapter: {
      number: chapter,
      lastVerse: 36,
      verses: Array.from({ length: 36 }, (_, index) => ({
        number: index + 1,
        lines: [{ text: `Versículo ${index + 1}` }],
      })),
    },
  }
}

function bundledBook(bookId: UsfmBookId): BundledResult<BookText> {
  const raw: unknown = JSON.parse(
    fs.readFileSync(`${ASSETS}/bsb/${bookId}.bible`, "utf8"),
  )
  const book = parseBookText(raw)
  return book.status === "ok"
    ? { status: "ok", value: book.value }
    : { status: "failed", reason: "invalid-data" }
}

function fixtureText(raw: unknown): ChapterText {
  const result = normalizeChapterFile(raw)
  if (result.status !== "ok") throw new TypeError(result.reason)
  return result.value
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function memoryStorage(read?: Promise<string | null>) {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => read ?? Promise.resolve(items.get(key) ?? null),
    setItem: async (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

const memoryCache: ChapterCache = {
  read: async () => null,
  has: () => false,
  write: () => true,
  usedBytes: () => 0,
}

type Setup = {
  fetchChapter?: (address: ChapterAddress) => Promise<ChapterFetchResult>
  loadCatalog?: () => Promise<BundledResult<Catalog>>
  positionRead?: Promise<string | null>
  phoneLanguage?: string | null
}

function makeServices(setup: Setup = {}) {
  const loadBundledBook = jest.fn(async (bookId: UsfmBookId) =>
    bundledBook(bookId),
  )
  const fetchChapter = jest.fn(
    setup.fetchChapter ?? (async (): Promise<ChapterFetchResult> => OFFLINE),
  )
  // Stable snapshots, as U4's store keeps them for useSyncExternalStore.
  const bundled: TranslationDownloadState = { kind: "bundled" }
  const notDownloaded: TranslationDownloadState = { kind: "not-downloaded" }
  const downloads = {
    check: jest.fn(async () => {}),
    getState: (id: string): TranslationDownloadState =>
      id === "BSB" ? bundled : notDownloaded,
    subscribe: () => () => {},
    readBook: async () => null,
  }
  const real = createChapterRepository({
    loadBundledBook,
    downloads,
    cache: memoryCache,
    fetchChapter,
  })
  const repository = { ...real, prefetch: jest.fn(real.prefetch) }
  const services: ReaderServices = {
    repository,
    downloads,
    loadCatalog:
      setup.loadCatalog ?? (async () => ({ status: "ok", value: CATALOG })),
    positionStore: createReadingPositionStore(
      memoryStorage(setup.positionRead),
    ),
    settingsStore: createReaderSettingsStore(memoryStorage()),
    readPhoneLanguage: () =>
      setup.phoneLanguage === undefined ? "en" : setup.phoneLanguage,
  }
  return { services, loadBundledBook, fetchChapter, downloads, repository }
}

type ProbeProps = {
  services: ReaderServices
  audioLanguage?: string | null
  audioReady?: boolean
  focused?: boolean
}

const seen: ReaderChapter[] = []

function Probe({
  services,
  audioLanguage = null,
  audioReady = true,
  focused = true,
}: ProbeProps) {
  const position = useReadingPosition(services.positionStore)
  seen.push(
    useReaderChapter({
      services,
      position,
      audioLanguage,
      audioReady,
      focused,
    }),
  )
  return null
}

function latest(): ReaderChapter {
  const last = seen[seen.length - 1]
  if (!last) throw new Error("the probe never rendered")
  return last
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
  })
}

const mounted: TestInstance[] = []

async function render(props: ProbeProps): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Probe {...props} />
      </StrictMode>,
    )
  })
  mounted.push(renderer)
  await flush()
  return renderer
}

async function rerender(renderer: TestInstance, props: ProbeProps) {
  await act(async () => {
    renderer.update(
      <StrictMode>
        <Probe {...props} />
      </StrictMode>,
    )
  })
  await flush()
}

beforeEach(() => {
  seen.length = 0
  ;(datadogLog.info as unknown as jest.Mock).mockClear()
  ;(datadogLog.warn as unknown as jest.Mock).mockClear()
  resetReaderTelemetryForTests()
})

function sent(level: "info" | "warn", name: string) {
  return (datadogLog[level] as unknown as jest.Mock).mock.calls
    .filter(([event]) => event === name)
    .map(([, context]) => context as Record<string, unknown>)
}

afterEach(async () => {
  for (const renderer of mounted.splice(0)) {
    await act(async () => renderer.unmount())
  }
})

describe("useReaderChapter under StrictMode", () => {
  it("waits for the saved position and the audio language, then loads", async () => {
    const read = deferred<string | null>()
    const parts = makeServices({ positionRead: read.promise })
    const renderer = await render({
      services: parts.services,
      audioReady: false,
    })
    expect(latest().state.status).toBe("waiting")

    await act(async () => read.resolve(null))
    await flush()
    // U5: wait for the audio language before choosing a translation.
    expect(latest().state.status).toBe("waiting")
    expect(parts.loadBundledBook).not.toHaveBeenCalled()

    await rerender(renderer, { services: parts.services, audioReady: true })
    const state = latest().state
    expect(state.status).toBe("ready")
    if (state.status !== "ready") return
    expect(state.shown.translation.id).toBe("BSB")
    expect(state.text.bookName).toBe("John")
    expect(state.translationRef).toEqual({ book: "JHN", chapter: 3, verse: 16 })
  })

  it("reads the book once through the double mount", async () => {
    const parts = makeServices()
    await render({ services: parts.services })
    expect(latest().state.status).toBe("ready")
    expect(parts.loadBundledBook).toHaveBeenCalledTimes(1)
  })

  it("checks the downloads at each open", async () => {
    const parts = makeServices()
    const renderer = await render({ services: parts.services })
    const opens = parts.downloads.check.mock.calls.length
    expect(opens).toBeGreaterThanOrEqual(1)
    await rerender(renderer, { services: parts.services, focused: false })
    await rerender(renderer, { services: parts.services, focused: true })
    expect(parts.downloads.check.mock.calls.length).toBeGreaterThan(opens)
  })

  it("keeps the chapter through a verse move inside it", async () => {
    const parts = makeServices()
    await render({ services: parts.services })
    const reads = parts.loadBundledBook.mock.calls.length
    const before = seen.length

    await act(async () => {
      parts.services.positionStore.moveTo({
        book: "JHN",
        chapter: 3,
        verse: 17,
      })
    })
    await flush()

    const after = seen.slice(before).map((result) => result.state.status)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((status) => status === "ready")).toBe(true)
    expect(parts.loadBundledBook).toHaveBeenCalledTimes(reads)
    const state = latest().state
    expect(state.status === "ready" && state.translationRef.verse).toBe(17)
  })

  it("covers AE16: offline, BSB stands in and no choice is saved", async () => {
    const parts = makeServices()
    const renderer = await render({
      services: parts.services,
      audioLanguage: "spa",
    })

    const state = latest().state
    expect(state.status).toBe("ready")
    if (state.status !== "ready") return
    expect(state.shown.translation.id).toBe("BSB")
    expect(state.shown.reason).toBe("offline-stand-in")
    expect(latest().offline).toBe(true)
    expect(parts.fetchChapter).toHaveBeenCalledWith({
      translationId: SPANISH,
      bookId: "JHN",
      chapter: 3,
    })
    expect(parts.services.positionStore.getSnapshot().translationId).toBeNull()

    // The network returns and the viewer opens the reader again.
    parts.fetchChapter.mockImplementation(async () => ({
      status: "ok",
      text: spanishJohn(3),
    }))
    await rerender(renderer, {
      services: parts.services,
      audioLanguage: "spa",
      focused: false,
    })
    await rerender(renderer, {
      services: parts.services,
      audioLanguage: "spa",
      focused: true,
    })
    const online = latest().state
    expect(latest().offline).toBe(false)
    expect(online.status).toBe("ready")
    if (online.status !== "ready") return
    expect(online.shown.translation.id).toBe(SPANISH)
    expect(online.shown.reason).toBe("viewer")
    expect(online.text.bookName).toBe("Juan")
  })

  it("covers R31: a picked translation offline fails, with BSB as the switch", async () => {
    const parts = makeServices()
    parts.services.positionStore.pickTranslation(SPANISH)
    await render({ services: parts.services })

    const state = latest().state
    expect(state.status).toBe("failed")
    if (state.status !== "failed") return
    expect(state.reason).toBe("offline")
    expect(state.switchTarget?.id).toBe("BSB")

    await act(async () => latest().switchToOnDevice())
    await flush()

    const switched = latest().state
    expect(switched.status).toBe("ready")
    if (switched.status !== "ready") return
    expect(switched.shown.translation.id).toBe("BSB")
    // The switch lasts for this session; the saved pick stays (R31, R41).
    const snapshot = parts.services.positionStore.getSnapshot()
    expect(snapshot.translationId).toBe(SPANISH)
    expect(snapshot.sessionTranslationId).toBe("BSB")
    // U14, R37: one change per tap, from the translation that failed.
    expect(sent("info", "bible_reader.translation_changed")).toEqual([
      {
        reader_change: "switched",
        reader_from_translation_id: SPANISH,
        reader_to_translation_id: "BSB",
      },
    ])
  })

  it("logs a shown chapter whose last verse differs from its system, once", async () => {
    // SYNTHETIC: John 3 ends at 36 in every system; 35 stands in for a
    // misclassified book (KTD6).
    const short = spanishJohn(3)
    const mismatched: ChapterText = {
      ...short,
      chapter: { ...short.chapter, lastVerse: 35 },
    }
    const parts = makeServices({
      fetchChapter: async () => ({ status: "ok", text: mismatched }),
    })
    parts.services.positionStore.pickTranslation(SPANISH)
    const renderer = await render({ services: parts.services })
    expect(latest().state.status).toBe("ready")

    // A second visit to the same chapter logs nothing new.
    await rerender(renderer, { services: parts.services, focused: false })
    await rerender(renderer, { services: parts.services, focused: true })
    expect(sent("warn", "bible_reader.versification_mismatch")).toEqual([
      {
        reader_translation_id: SPANISH,
        reader_book: "JHN",
        reader_chapter: 3,
        reader_system: "eng",
        reader_mapped_last_verse: 36,
        reader_actual_last_verse: 35,
      },
    ])
  })

  it("logs no mismatch for a chapter that ends where its system says", async () => {
    const parts = makeServices()
    await render({ services: parts.services })
    expect(latest().state.status).toBe("ready")
    expect(sent("warn", "bible_reader.versification_mismatch")).toHaveLength(0)
  })

  it("retries a failed chapter", async () => {
    const parts = makeServices({
      fetchChapter: async () => ({
        status: "failed",
        reason: "http-status",
        httpStatus: 503,
      }),
    })
    parts.services.positionStore.pickTranslation(SPANISH)
    await render({ services: parts.services })
    expect(latest().state.status).toBe("failed")
    // A server error is not a missing network.
    expect(latest().offline).toBe(false)
    const calls = parts.fetchChapter.mock.calls.length

    parts.fetchChapter.mockImplementation(async () => ({
      status: "ok",
      text: spanishJohn(3),
    }))
    await act(async () => latest().retry())
    await flush()

    expect(parts.fetchChapter.mock.calls.length).toBeGreaterThan(calls)
    expect(latest().state.status).toBe("ready")
  })

  it("never shows a chapter the reader already left", async () => {
    const pending = new Map<
      number,
      ReturnType<typeof deferred<ChapterFetchResult>>
    >()
    const parts = makeServices({
      fetchChapter: (address) => {
        const answer = deferred<ChapterFetchResult>()
        pending.set(address.chapter, answer)
        return answer.promise
      },
    })
    parts.services.positionStore.pickTranslation(SPANISH)
    await render({ services: parts.services })
    expect(latest().state.status).toBe("loading")

    await act(async () => {
      parts.services.positionStore.moveTo({ book: "JHN", chapter: 4, verse: 1 })
    })
    await flush()
    await act(async () => {
      pending.get(4)?.resolve({ status: "ok", text: spanishJohn(4) })
    })
    await flush()
    await act(async () => {
      pending.get(3)?.resolve({ status: "ok", text: spanishJohn(3) })
    })
    await flush()

    const state = latest().state
    expect(state.status === "ready" && state.text.chapter.number).toBe(4)
    const shownChapters = seen
      .map((result) => result.state)
      .filter((item) => item.status === "ready")
      .map((item) => (item.status === "ready" ? item.text.chapter.number : 0))
    expect(shownChapters).not.toContain(3)
  })

  it("keeps the next chapter after a network read", async () => {
    const parts = makeServices({
      fetchChapter: async (address) => ({
        status: "ok",
        text: spanishJohn(address.chapter),
      }),
    })
    parts.services.positionStore.pickTranslation(SPANISH)
    await render({ services: parts.services })
    expect(latest().state.status).toBe("ready")
    expect(parts.repository.prefetch).toHaveBeenCalledWith(
      expect.objectContaining({
        translationId: SPANISH,
        bookId: "JHN",
        chapter: 4,
      }),
    )
  })

  it("shows the catalog failure, and a retry reads the catalog again", async () => {
    let answer: BundledResult<Catalog> = {
      status: "failed",
      reason: "read-failed",
    }
    const loadCatalog = jest.fn(async () => answer)
    const parts = makeServices({ loadCatalog })
    await render({ services: parts.services })
    expect(latest().state.status).toBe("catalog-failed")

    answer = { status: "ok", value: CATALOG }
    await act(async () => latest().retry())
    await flush()
    expect(latest().state.status).toBe("ready")
  })
})

describe("useReaderChapter goTo (U8, R38, R42)", () => {
  // Synodal Psalm 50 is BSB Psalm 51, and its verses 1 and 2 are the title,
  // which has no BSB counterpart: both save as BSB 51:1 (U2's anchor rule).
  function synodal() {
    const parts = makeServices({
      fetchChapter: async () => ({
        status: "ok",
        text: fixtureText(synodalPsalm50),
      }),
    })
    parts.services.positionStore.pickTranslation("rus_syn")
    parts.services.positionStore.moveTo({ book: "PSA", chapter: 51, verse: 1 })
    return parts
  }

  const shownRef = () => {
    const state = latest().state
    return state.status === "ready" ? state.translationRef : null
  }
  const storedRef = (services: ReaderServices) =>
    services.positionStore.getSnapshot().ref

  it("shows a title stop that BSB lacks, while the store keeps its anchor", async () => {
    const { services } = synodal()
    await render({ services })
    expect(shownRef()).toEqual({ book: "PSA", chapter: 50, verse: 3 })

    await act(async () =>
      latest().goTo({ book: "PSA", chapter: 50, verse: 2 }, "rus_syn"),
    )
    await flush()
    expect(shownRef()).toEqual({ book: "PSA", chapter: 50, verse: 2 })
    expect(storedRef(services)).toEqual({ book: "PSA", chapter: 51, verse: 1 })

    await act(async () =>
      latest().goTo({ book: "PSA", chapter: 50, verse: 1 }, "rus_syn"),
    )
    await flush()
    expect(shownRef()).toEqual({ book: "PSA", chapter: 50, verse: 1 })

    // Back to a verse BSB has: the same stored anchor now shows 50:3.
    await act(async () =>
      latest().goTo({ book: "PSA", chapter: 50, verse: 3 }, "rus_syn"),
    )
    await flush()
    expect(shownRef()).toEqual({ book: "PSA", chapter: 50, verse: 3 })

    await act(async () =>
      latest().goTo({ book: "PSA", chapter: 50, verse: 4 }, "rus_syn"),
    )
    await flush()
    expect(shownRef()).toEqual({ book: "PSA", chapter: 50, verse: 4 })
    expect(storedRef(services)).toEqual({ book: "PSA", chapter: 51, verse: 2 })
  })

  it("drops the title stop when someone else moves the reader", async () => {
    const { services } = synodal()
    await render({ services })
    await act(async () =>
      latest().goTo({ book: "PSA", chapter: 50, verse: 1 }, "rus_syn"),
    )
    await flush()
    expect(shownRef()).toEqual({ book: "PSA", chapter: 50, verse: 1 })

    // A picker jump or a quote writes the store directly.
    await act(async () => {
      services.positionStore.moveTo({ book: "PSA", chapter: 51, verse: 5 })
    })
    await flush()
    expect(shownRef()).toEqual({ book: "PSA", chapter: 50, verse: 7 })
  })

  it("saves a move in another book's BSB numbers", async () => {
    const { services } = makeServices()
    await render({ services })
    await act(async () =>
      latest().goTo({ book: "MAT", chapter: 1, verse: 1 }, "BSB"),
    )
    await flush()
    expect(storedRef(services)).toEqual({ book: "MAT", chapter: 1, verse: 1 })
    expect(shownRef()).toEqual({ book: "MAT", chapter: 1, verse: 1 })
  })
})

describe("nextChapterRequest", () => {
  const base = {
    translationId: SPANISH,
    bookId: "JHN" as const,
    sha256: "0".repeat(64),
  }

  it("asks for the next chapter of the same book", () => {
    expect(nextChapterRequest({ ...base, chapter: 3 })).toEqual({
      ...base,
      chapter: 4,
    })
  })

  it("asks for nothing after the last chapter of the book", () => {
    expect(nextChapterRequest({ ...base, chapter: 21 })).toBeNull()
  })
})
