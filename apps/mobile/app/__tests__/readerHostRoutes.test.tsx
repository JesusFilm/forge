/**
 * The reader's two hosts (feat-551 U11, KTD9): the Bible tab and the pushed
 * root route. Real stores and the U4 repository over the bundled BSB; a fake
 * router, fake focus, and fake services. Every case renders under StrictMode.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// tsconfig maps `react` to its .d.ts; re-point it (see AccountSection.test.tsx).
jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => true,
  isGlassEffectAPIAvailable: () => true,
}))
jest.mock("../../src/components/ui/PlatformBlur", () => ({
  PlatformBlur: () => null,
}))
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))
jest.mock("../../src/contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => ({ audioLanguageIso3: null, isReady: true }),
}))

type MockRoute = {
  params: Record<string, unknown>
  focused: boolean
  push: jest.Mock
  back: jest.Mock
  services: unknown
  onboarding: unknown
}
const mockRoute: MockRoute = {
  params: {},
  focused: true,
  push: jest.fn(),
  back: jest.fn(),
  services: null,
  onboarding: null,
}
jest.mock("expo-router", () => {
  const { createContext, useContext } =
    require("react") as typeof import("react")
  // Two mounted hosts can differ in focus; with no provider, the flag decides.
  const focus = createContext<boolean | null>(null)
  return {
    MockFocus: focus.Provider,
    useIsFocused: () => useContext(focus) ?? mockRoute.focused,
    useLocalSearchParams: () => mockRoute.params,
    useRouter: () => ({ push: mockRoute.push, back: mockRoute.back }),
  }
})
jest.mock("../../src/lib/bible/reader/services", () => ({
  getReaderServices: () => mockRoute.services,
}))
jest.mock("../../src/lib/bible/onboarding/store", () => ({
  ...jest.requireActual("../../src/lib/bible/onboarding/store"),
  getReaderOnboardingStore: () => mockRoute.onboarding,
}))
jest.mock("../../src/lib/bible/sheets/downloadPrompt", () => ({
  presentReaderDownloadPrompt: jest.fn(async () => {}),
}))
jest.mock("../../src/lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { StrictMode, act, type ComponentType, type ReactNode } from "react"
import { Animated, Dimensions, StyleSheet } from "react-native"

import BibleTabRoute from "../(tabs)/bible"
import ReaderRoute from "../reader"
import { CHAPTER_PULSE_MS } from "../../src/components/bible/ChapterPill"
import type { BundledResult } from "../../src/lib/bible/data/bundled"
import { parseCatalog, type Catalog } from "../../src/lib/bible/data/catalog"
import {
  READER_ONBOARDING_STORAGE_KEY,
  createReaderOnboardingStore,
  serializeReaderOnboarding,
} from "../../src/lib/bible/onboarding/store"
import {
  READING_POSITION_STORAGE_KEY,
  serializeReadingPosition,
} from "../../src/lib/bible/position/snapshot"
import {
  createReadingPositionStore,
  type ReadingPositionStore,
} from "../../src/lib/bible/position/store"
import { READER_COPY } from "../../src/lib/bible/reader/copy"
import type { ReaderServices } from "../../src/lib/bible/reader/services"
import type { ChapterCache } from "../../src/lib/bible/repository/chapterCache"
import { createChapterRepository } from "../../src/lib/bible/repository/resolveChapter"
import type { TranslationDownloadState } from "../../src/lib/bible/repository/translationDownloads"
import { readerHref } from "../../src/lib/bible/routes/readerRoute"
import { datadogLog } from "../../src/lib/datadog"
import { createReaderSettingsStore } from "../../src/lib/bible/settings/store"
import { presentReaderDownloadPrompt } from "../../src/lib/bible/sheets/downloadPrompt"
import { readerSheetHref } from "../../src/lib/bible/sheets/routes"
import { getPlaybackRequestStore } from "../../src/lib/miniPlayer/playbackRequest"
import type { UsfmBookId } from "../../src/lib/bible/text/books"
import { parseBookText } from "../../src/lib/bible/text/normalize"
import type { BookText } from "../../src/lib/bible/text/types"
import type { VerseRef } from "../../src/lib/bible/versification/convert"
import {
  createNativeLayout,
  type NativeFrame,
  type NativeLayout,
} from "../../src/test-utils/fabricLayout"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")
const ASSETS = `${__dirname}/../../assets/bible`

function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(
    fs.readFileSync(`${ASSETS}/catalog.bible`, "utf8"),
  )
  const catalog = parseCatalog(raw)
  if (!catalog) throw new Error("the bundled catalog did not parse")
  return catalog
}

const CATALOG = loadCatalog()
const BSB = CATALOG.byId.get("BSB")!

function bundledBook(bookId: UsfmBookId): BundledResult<BookText> {
  const raw: unknown = JSON.parse(
    fs.readFileSync(`${ASSETS}/bsb/${bookId}.bible`, "utf8"),
  )
  const book = parseBookText(raw)
  return book.status === "ok"
    ? { status: "ok", value: book.value }
    : { status: "failed", reason: "invalid-data" }
}

function memoryStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed))
  return {
    getItem: async (key: string) => items.get(key) ?? null,
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

const JOHN_3_16: VerseRef = { book: "JHN", chapter: 3, verse: 16 }
const GENESIS_1_1: VerseRef = { book: "GEN", chapter: 1, verse: 1 }

type LoadBook = (bookId: UsfmBookId) => Promise<BundledResult<BookText>>

/** The app's services with a position store that may hold a saved verse. */
function install(
  savedRef: VerseRef | null = null,
  loadBook: LoadBook = async (bookId) => bundledBook(bookId),
): ReadingPositionStore {
  const bundled: TranslationDownloadState = { kind: "bundled" }
  const notDownloaded: TranslationDownloadState = { kind: "not-downloaded" }
  const downloads = {
    check: async () => {},
    getState: (id: string): TranslationDownloadState =>
      id === "BSB" ? bundled : notDownloaded,
    subscribe: () => () => {},
    readBook: async () => null,
  }
  const position = createReadingPositionStore(
    memoryStorage(
      savedRef
        ? {
            [READING_POSITION_STORAGE_KEY]: serializeReadingPosition({
              ref: savedRef,
              translationId: null,
            }),
          }
        : {},
    ),
  )
  const services: ReaderServices = {
    repository: createChapterRepository({
      loadBundledBook: loadBook,
      downloads,
      cache: memoryCache,
      fetchChapter: async () => ({ status: "failed", reason: "offline" }),
    }),
    downloads,
    loadCatalog: async () => ({ status: "ok", value: CATALOG }),
    positionStore: position,
    settingsStore: createReaderSettingsStore(memoryStorage()),
    readPhoneLanguage: () => "en",
  }
  mockRoute.services = services
  return position
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 25; i += 1) await Promise.resolve()
  })
}

const mounted: TestInstance[] = []

async function renderRoute(Route: ComponentType): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Route />
      </StrictMode>,
    )
  })
  mounted.push(renderer)
  await flush()
  return renderer
}

/** Re-renders a route, as a focus change does. */
async function rerender(renderer: TestInstance, Route: ComponentType) {
  await act(async () => {
    renderer.update(
      <StrictMode>
        <Route />
      </StrictMode>,
    )
  })
  await flush()
}

/** Host controls only: a Pressable passes its label down to one View. */
function controls(renderer: TestInstance, matches: (label: string) => boolean) {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button" &&
      matches(String(node.props.accessibilityLabel ?? "")),
  )
}

function pills(renderer: TestInstance, passage: string) {
  return controls(
    renderer,
    (label) => label === READER_COPY.choosePassage(passage),
  )
}

async function press(
  renderer: TestInstance,
  matches: (label: string) => boolean,
) {
  const [control] = renderer.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.props.accessibilityRole === "button" &&
      matches(String(node.props.accessibilityLabel ?? "")),
  )
  expect(control).toBeDefined()
  await act(async () => control!.props.onPress?.())
}

let timing: jest.SpyInstance

beforeEach(() => {
  mockRoute.params = {}
  mockRoute.focused = true
  mockRoute.push = jest.fn()
  mockRoute.back = jest.fn()
  mockRoute.onboarding = createReaderOnboardingStore(
    memoryStorage({
      [READER_ONBOARDING_STORAGE_KEY]: serializeReaderOnboarding({
        hintRetired: true,
        demoPlayed: true,
      }),
    }),
  )
  // Jest 29's restoreAllMocks also drops a factory mock's implementation.
  jest.mocked(presentReaderDownloadPrompt).mockReset()
  jest.mocked(presentReaderDownloadPrompt).mockImplementation(async () => {})
  timing = jest.spyOn(Animated, "timing")
})

afterEach(async () => {
  for (const renderer of mounted.splice(0)) {
    await act(async () => renderer.unmount())
  }
  jest.restoreAllMocks()
})

const pulses = () =>
  timing.mock.calls.filter(
    ([, config]) =>
      (config as Animated.TimingAnimationConfig).duration === CHAPTER_PULSE_MS,
  ).length

describe("the pushed reader route (app/reader.tsx)", () => {
  it("opens at the pushed John 3:16 and moves the shared position (R1)", async () => {
    const position = install(GENESIS_1_1)
    await position.hydrate()
    mockRoute.params = readerHref(JOHN_3_16, "quote").params

    const renderer = await renderRoute(ReaderRoute)

    expect(pills(renderer, "John 3:16")).toHaveLength(1)
    expect(position.getSnapshot().ref).toEqual(JOHN_3_16)
    // Opening the reader plays no animation (R39).
    expect(pulses()).toBe(0)
  })

  it("refuses malformed params and opens the saved position", async () => {
    const position = install(GENESIS_1_1)
    mockRoute.params = { book: ["JHN"], chapter: "3x", verse: { n: 16 } }
    const renderer = await renderRoute(ReaderRoute)
    expect(pills(renderer, "Genesis 1:1")).toHaveLength(1)
    expect(position.getSnapshot().ref).toEqual(GENESIS_1_1)
  })

  it("refuses malformed params and opens John 3:16 with nothing saved (R3)", async () => {
    const position = install()
    mockRoute.params = { book: "JHN", chapter: "999", verse: "1" }
    const renderer = await renderRoute(ReaderRoute)
    expect(pills(renderer, "John 3:16")).toHaveLength(1)
    // The default is a place to open, not a move: nothing is saved.
    expect(position.getSnapshot().ref).toBeNull()
  })

  it("has a back button that pops the route (R6)", async () => {
    install()
    mockRoute.params = readerHref(JOHN_3_16, "quote").params
    const renderer = await renderRoute(ReaderRoute)
    const isBack = (label: string) => label === READER_COPY.back
    expect(controls(renderer, isBack)).toHaveLength(1)
    await press(renderer, isBack)
    expect(mockRoute.back).toHaveBeenCalledTimes(1)
    expect(mockRoute.push).not.toHaveBeenCalled()
  })
})

describe("the Bible tab route (app/(tabs)/bible.tsx)", () => {
  it("opens at the saved position, with no back button (R3)", async () => {
    install(GENESIS_1_1)
    const renderer = await renderRoute(BibleTabRoute)
    expect(pills(renderer, "Genesis 1:1")).toHaveLength(1)
    expect(
      controls(renderer, (label) => label === READER_COPY.back),
    ).toHaveLength(0)
  })

  it("opens at John 3:16 with no saved position (R3)", async () => {
    install()
    const renderer = await renderRoute(BibleTabRoute)
    expect(pills(renderer, "John 3:16")).toHaveLength(1)
  })

  it("shows the pushed reader's new position when it regains focus, with no pulse", async () => {
    const position = install(GENESIS_1_1)
    const tab = await renderRoute(BibleTabRoute)
    expect(pills(tab, "Genesis 1:1")).toHaveLength(1)

    // A quote pushes the reader over the watch screen; the tab is covered.
    mockRoute.focused = false
    await rerender(tab, BibleTabRoute)
    mockRoute.params = readerHref(JOHN_3_16, "quote").params
    const pushed = await renderRoute(ReaderRoute)
    expect(position.getSnapshot().ref).toEqual(JOHN_3_16)
    await act(async () => pushed.unmount())
    mounted.splice(mounted.indexOf(pushed), 1)

    mockRoute.focused = true
    await rerender(tab, BibleTabRoute)
    expect(pills(tab, "John 3:16")).toHaveLength(1)
    expect(pulses()).toBe(0)
  })
})

// U14, R37: each route names how the reader opened. The pushed route passes
// the source it parsed; a param that is not exactly "quote" is a link.
describe("the reader open source (U14, KTD18)", () => {
  const opens = () =>
    (datadogLog.info as unknown as jest.Mock).mock.calls
      .filter(([event]) => event === "bible_reader.opened")
      .map(([, context]) => context as Record<string, unknown>)

  beforeEach(() => (datadogLog.info as unknown as jest.Mock).mockClear())

  it("logs quote for a reader that a quote card pushed", async () => {
    install()
    mockRoute.params = readerHref(JOHN_3_16, "quote").params
    await renderRoute(ReaderRoute)
    expect(opens()).toEqual([{ reader_source: "quote" }])
  })

  it("logs link for a pushed reader with no quote source", async () => {
    install()
    mockRoute.params = { book: "JHN", chapter: "3", verse: "16" }
    await renderRoute(ReaderRoute)
    expect(opens()).toEqual([{ reader_source: "link" }])
  })

  it("logs tab for the Bible tab", async () => {
    install()
    await renderRoute(BibleTabRoute)
    expect(opens()).toEqual([{ reader_source: "tab" }])
  })
})

// U13, R10: the host publishes the resting mini player; each route hands that
// frame to its reader, and the verse box keeps clear of it.
describe.each([
  ["the Bible tab", BibleTabRoute],
  ["the pushed reader", ReaderRoute],
] as const)("%s keeps its verse clear of the mini player", (_host, Route) => {
  const store = getPlaybackRequestStore()
  afterEach(() => store.setWindowFrame(null))

  function verseArea(renderer: TestInstance) {
    const [area] = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.testID === "bible-verse-area",
    )
    expect(area).toBeDefined()
    const style = StyleSheet.flatten(area!.props.style) as {
      top: number
      height: number
    }
    return { top: Number(style.top), height: Number(style.height) }
  }

  it("shrinks the verse box under the window, and grows it back when it goes", async () => {
    install()
    mockRoute.params = readerHref(JOHN_3_16, "quote").params
    const renderer = await renderRoute(Route)
    const clear = verseArea(renderer)
    // A window resting in a top corner, deeper than the box's top edge.
    const frame = { x: 300, y: clear.top - 20, width: 185, height: 180 }

    await act(async () => {
      store.setWindowFrame(frame)
    })

    const covered = verseArea(renderer)
    expect(covered.top).toBeGreaterThanOrEqual(frame.y + frame.height)
    expect(covered.height).toBeLessThan(clear.height)

    await act(async () => {
      store.setWindowFrame(null)
    })
    expect(verseArea(renderer)).toEqual(clear)
  })
})

describe.each([
  ["the Bible tab", BibleTabRoute],
  ["the pushed reader", ReaderRoute],
] as const)("%s's sheet controls (U10)", (_host, Route) => {
  // The context both hosts send for BSB John 3:16, online.
  const CONTEXT = {
    translation: BSB,
    translationRef: JOHN_3_16,
    ref: JOHN_3_16,
    offline: false,
  }

  async function open() {
    install()
    mockRoute.params = readerHref(JOHN_3_16, "quote").params
    return renderRoute(Route)
  }

  it("pushes the passage picker's href from the pill", async () => {
    const renderer = await open()
    await press(
      renderer,
      (label) => label === READER_COPY.choosePassage("John 3:16"),
    )
    expect(mockRoute.push).toHaveBeenCalledTimes(1)
    expect(mockRoute.push).toHaveBeenCalledWith(
      readerSheetHref("passage", CONTEXT),
    )
  })

  it("pushes the translation picker's href from the footer label", async () => {
    const renderer = await open()
    await press(
      renderer,
      (label) => label === READER_COPY.translation(BSB.name),
    )
    expect(mockRoute.push).toHaveBeenCalledWith(
      readerSheetHref("translation", CONTEXT),
    )
  })

  it("pushes the settings sheet's href", async () => {
    const renderer = await open()
    await press(renderer, (label) => label === READER_COPY.settings)
    expect(mockRoute.push).toHaveBeenCalledWith(
      readerSheetHref("settings", CONTEXT),
    )
  })

  it("opens the download prompt for the shown translation, with no push", async () => {
    const renderer = await open()
    await press(
      renderer,
      (label) => label === READER_COPY.download.onDevice(BSB.name),
    )
    expect(presentReaderDownloadPrompt).toHaveBeenCalledTimes(1)
    expect(
      jest.mocked(presentReaderDownloadPrompt).mock.calls[0]?.[0],
    ).toMatchObject({ translation: { id: "BSB" }, ref: JOHN_3_16 })
    expect(mockRoute.push).not.toHaveBeenCalled()
  })
})

// KTD16 on Android: the verse hides until its measuring copy reports a height.
// A chapter from memory can show before the reader's first layout; then both
// layouts land in one event flush. Seen on a Pixel 9a, 2026-09-25.
describe("the verse fit when the chapter shows before the reader's first layout", () => {
  // SYNTHETIC Pixel 9a window. Dimensions.js divides pixels by the scale in 64
  // bits, and Yoga lays the reader out in 32 bits, so the two widths differ.
  const PIXEL_9A = {
    width: 1080 / 2.625,
    height: 2424 / 2.625,
    scale: 2.625,
    fontScale: 1,
  }
  const ROMANS_8_28: VerseRef = { book: "ROM", chapter: 8, verse: 28 }
  const ROMANS_8_1: VerseRef = { book: "ROM", chapter: 8, verse: 1 }
  const GENESIS_1_26: VerseRef = { book: "GEN", chapter: 1, verse: 26 }
  /** SYNTHETIC: the verse is 120 points tall at every size, so it fits. */
  const VERSE_HEIGHT = 120
  const originalWindow = Dimensions.get("window")

  beforeEach(() => {
    act(() => {
      Dimensions.set({ window: PIXEL_9A, screen: PIXEL_9A })
    })
  })
  afterEach(() => {
    act(() => {
      Dimensions.set({ window: originalWindow, screen: originalWindow })
    })
  })

  function frameOf(node: RenderedNode): NativeFrame | null {
    const testID = String(node.props.testID ?? "")
    if (testID === "bible-reader") {
      const { width, height } = Dimensions.get("window")
      return { x: 0, y: 0, width, height }
    }
    if (!testID.startsWith("bible-verse-measure-")) return null
    const { width } = StyleSheet.flatten(node.props.style) as { width: number }
    return { x: 0, y: 0, width, height: VERSE_HEIGHT }
  }

  /** Book reads wait for `release`, as a read from disk takes a while. */
  function slowBooks() {
    const waiting: (() => void)[] = []
    const load: LoadBook = (bookId) =>
      new Promise((resolve) => {
        waiting.push(() => resolve(bundledBook(bookId)))
      })
    return {
      load,
      pending: () => waiting.length,
      release: async () => {
        for (const read of waiting.splice(0)) read()
        await flush()
      },
    }
  }

  type FocusProvider = ComponentType<{ value: boolean; children: ReactNode }>

  async function mountHost(Route: ComponentType, focused: boolean) {
    const { MockFocus } = jest.requireMock<{ MockFocus: FocusProvider }>(
      "expo-router",
    )
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        <StrictMode>
          <MockFocus value={focused}>
            <Route />
          </MockFocus>
        </StrictMode>,
      )
    })
    mounted.push(renderer)
    await flush()
    return renderer
  }

  async function unmountHost(renderer: TestInstance) {
    await act(async () => renderer.unmount())
    mounted.splice(mounted.indexOf(renderer), 1)
  }

  /** The fit's own signal: 0 while the verse hides, 1 once it settles. */
  function verseOpacity(renderer: TestInstance): unknown {
    const verses = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" && node.props.testID === "bible-verse",
    )
    expect(verses).toHaveLength(1)
    return (StyleSheet.flatten(verses[0]!.props.style) as { opacity?: number })
      .opacity
  }

  /** A host whose first read comes from disk: its root layout lands first. */
  async function openFromDisk(
    Route: ComponentType,
    focused: boolean,
    books: ReturnType<typeof slowBooks>,
    layout: NativeLayout,
  ) {
    const renderer = await mountHost(Route, focused)
    expect(books.pending()).toBe(1)
    await layout.beat(renderer)
    await books.release()
    await layout.settle(renderer)
    expect(verseOpacity(renderer)).toBe(1)
    return renderer
  }

  it.each([
    ["the saved verse", ROMANS_8_28],
    ["another verse of the saved chapter", ROMANS_8_1],
  ])(
    "shows the verse when a link pushes %s over the blurred tab",
    async (_case, pushedRef) => {
      const books = slowBooks()
      const position = install(ROMANS_8_28, books.load)
      await position.hydrate()
      const layout = createNativeLayout(frameOf)
      // The viewer is on Home; the Bible tab showed Romans 8:28 before.
      await openFromDisk(BibleTabRoute, false, books, layout)

      mockRoute.params = readerHref(pushedRef, "link").params
      const pushed = await mountHost(ReaderRoute, true)
      // Romans comes from memory, so the verse is there before any layout.
      expect(books.pending()).toBe(0)
      expect(position.getSnapshot().ref).toEqual(pushedRef)
      expect(verseOpacity(pushed)).toBe(0)

      await layout.settle(pushed)
      expect(verseOpacity(pushed)).toBe(1)
    },
  )

  it("shows the verse on the Bible tab's first open after a push read its book", async () => {
    const books = slowBooks()
    install(null, books.load)
    const layout = createNativeLayout(frameOf)
    mockRoute.params = readerHref(ROMANS_8_28, "quote").params
    const pushed = await openFromDisk(ReaderRoute, true, books, layout)
    await unmountHost(pushed)

    // The tab mounts on its first focus, and Romans comes from memory.
    const tab = await mountHost(BibleTabRoute, true)
    expect(books.pending()).toBe(0)
    expect(verseOpacity(tab)).toBe(0)

    await layout.settle(tab)
    expect(verseOpacity(tab)).toBe(1)
  })

  // The device control: a push to another book reads that book from disk, so
  // the reader's first layout lands before the verse shows.
  it("shows the verse when a link pushes another book over the blurred tab", async () => {
    const books = slowBooks()
    const position = install(GENESIS_1_26, books.load)
    await position.hydrate()
    const layout = createNativeLayout(frameOf)
    await openFromDisk(BibleTabRoute, false, books, layout)

    mockRoute.params = readerHref(ROMANS_8_28, "link").params
    await openFromDisk(ReaderRoute, true, books, layout)
  })
})
