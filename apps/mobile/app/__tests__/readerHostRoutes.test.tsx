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
jest.mock("expo-router", () => ({
  useIsFocused: () => mockRoute.focused,
  useLocalSearchParams: () => mockRoute.params,
  useRouter: () => ({ push: mockRoute.push, back: mockRoute.back }),
}))
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

import { StrictMode, act, type ComponentType } from "react"
import { Animated } from "react-native"

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
import { createReaderSettingsStore } from "../../src/lib/bible/settings/store"
import { presentReaderDownloadPrompt } from "../../src/lib/bible/sheets/downloadPrompt"
import { readerSheetHref } from "../../src/lib/bible/sheets/routes"
import type { UsfmBookId } from "../../src/lib/bible/text/books"
import { parseBookText } from "../../src/lib/bible/text/normalize"
import type { BookText } from "../../src/lib/bible/text/types"
import type { VerseRef } from "../../src/lib/bible/versification/convert"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
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

/** The app's services with a position store that may hold a saved verse. */
function install(savedRef: VerseRef | null = null): ReadingPositionStore {
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
      loadBundledBook: async (bookId) => bundledBook(bookId),
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
