// The shared reader surface (feat-551 U7): real stores and U4 repository over
// the real bundled BSB and U1 fixtures. The renderer has no layout, so cases
// fire the measuring copies' onLayout with a SYNTHETIC height model (below).

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
jest.mock("../../ui/PlatformBlur", () => ({ PlatformBlur: () => null }))
const mockStatusBars: string[] = []
jest.mock("expo-status-bar", () => ({
  StatusBar: ({ style }: { style: string }) => {
    mockStatusBars.push(style)
    return null
  },
}))
const mockFocus = { focused: true }
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocus.focused }))
const mockInsets = { top: 62, bottom: 34, left: 0, right: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
const mockWatchPrefs = {
  audioLanguageIso3: null as string | null,
  isReady: true,
}
jest.mock("../../../contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => mockWatchPrefs,
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { StrictMode, act } from "react"
import {
  AccessibilityInfo,
  Dimensions,
  StyleSheet,
  type StyleProp,
  type TextStyle,
} from "react-native"

import t4tJohn4 from "../../../lib/bible/text/__tests__/fixtures/eng_t4t-jhn-4.json"
import arabicJohn3 from "../../../lib/bible/text/__tests__/fixtures/arb_vdv-jhn-3.json"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import type { BundledResult } from "../../../lib/bible/data/bundled"
import { parseCatalog, type Catalog } from "../../../lib/bible/data/catalog"
import {
  READER_ONBOARDING_STORAGE_KEY,
  createReaderOnboardingStore,
  serializeReaderOnboarding,
  type ReaderOnboardingStore,
} from "../../../lib/bible/onboarding/store"
import { createReadingPositionStore } from "../../../lib/bible/position/store"
import {
  READING_POSITION_STORAGE_KEY,
  serializeReadingPosition,
} from "../../../lib/bible/position/snapshot"
import type { ChapterCache } from "../../../lib/bible/repository/chapterCache"
import type {
  ChapterAddress,
  ChapterFetchResult,
} from "../../../lib/bible/repository/fetchChapter"
import { createChapterRepository } from "../../../lib/bible/repository/resolveChapter"
import type { TranslationDownloadState } from "../../../lib/bible/repository/translationDownloads"
import { createReaderSettingsStore } from "../../../lib/bible/settings/store"
import {
  READER_PALETTES,
  READER_TEXT_SIZE_STEPS,
} from "../../../lib/bible/settings/snapshot"
import type { UsfmBookId } from "../../../lib/bible/text/books"
import {
  normalizeChapterFile,
  parseBookText,
} from "../../../lib/bible/text/normalize"
import type { BookText } from "../../../lib/bible/text/types"
import type { VerseRef } from "../../../lib/bible/versification/convert"
import { fitFloor } from "../../../lib/bible/fit/fitVerse"
import { VERSE_BOX_GAP } from "../../../lib/bible/fit/verseBox"
import { contrastRatio } from "../../../lib/bible/theme/contrast"
import { READER_SCHEMES, readerTokens } from "../../../lib/bible/theme/palettes"
import { READER_COPY } from "../../../lib/bible/reader/copy"
import {
  READER_TOP_BAR_HEIGHT,
  READER_TOUCH_TARGET,
  getReaderMovementBand,
  readerMovementBandHeight,
  resetReaderMovementBandForTests,
} from "../../../lib/bible/reader/chrome"
import type { ReaderServices } from "../../../lib/bible/reader/services"
import { datadogLog } from "../../../lib/datadog"
import {
  BibleReader,
  READER_LOADING_DELAY_MS,
  type BibleReaderProps,
} from "../BibleReader"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")
const ASSETS = `${__dirname}/../../../../assets/bible`

function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(
    fs.readFileSync(`${ASSETS}/catalog.bible`, "utf8"),
  )
  const catalog = parseCatalog(raw)
  if (!catalog) throw new Error("the bundled catalog did not parse")
  return catalog
}

const CATALOG = loadCatalog()

function bundledBook(bookId: UsfmBookId): BundledResult<BookText> {
  const raw: unknown = JSON.parse(
    fs.readFileSync(`${ASSETS}/bsb/${bookId}.bible`, "utf8"),
  )
  const book = parseBookText(raw)
  return book.status === "ok"
    ? { status: "ok", value: book.value }
    : { status: "failed", reason: "invalid-data" }
}

function fixtureText(raw: unknown) {
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

function makeServices(
  fetchChapter: (
    address: ChapterAddress,
  ) => Promise<ChapterFetchResult> = async () => ({
    status: "failed",
    reason: "offline",
  }),
) {
  // Stable snapshots, as U4's store keeps them for useSyncExternalStore.
  const bundled: TranslationDownloadState = { kind: "bundled" }
  const notDownloaded: TranslationDownloadState = { kind: "not-downloaded" }
  const downloads = {
    check: async () => {},
    getState: (id: string): TranslationDownloadState =>
      id === "BSB" ? bundled : notDownloaded,
    subscribe: () => () => {},
    readBook: async () => null,
  }
  const fetch = jest.fn(fetchChapter)
  const services: ReaderServices = {
    repository: createChapterRepository({
      loadBundledBook: async (bookId) => bundledBook(bookId),
      downloads,
      cache: memoryCache,
      fetchChapter: fetch,
    }),
    downloads,
    loadCatalog: async () => ({ status: "ok", value: CATALOG }),
    positionStore: createReadingPositionStore(memoryStorage()),
    settingsStore: createReaderSettingsStore(memoryStorage()),
    readPhoneLanguage: () => "en",
  }
  return { services, fetch }
}

// iPhone 17 Pro Max.
const WINDOW = { width: 440, height: 956, scale: 3, fontScale: 1 }
const originalWindow = Dimensions.get("window")

function flat(node: RenderedNode): TextStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) ?? {}
}

function hosts(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
) {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && predicate(node),
  )
}

function byTestId(renderer: TestInstance, testID: string) {
  return hosts(renderer, (node) => node.props.testID === testID)
}

/** One host View per control: Pressable passes the role and style down. */
function controlHosts(renderer: TestInstance) {
  return hosts(renderer, (node) => node.props.accessibilityRole === "button")
}

function controlHostsLabelled(
  renderer: TestInstance,
  matches: (label: string) => boolean,
) {
  return controlHosts(renderer).filter((node) =>
    matches(String(node.props.accessibilityLabel ?? "")),
  )
}

/** The Pressable itself holds `onPress`; its host View does not. */
async function pressControl(
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

function textOf(node: RenderedNode): string {
  const { children } = node.props
  const parts = Array.isArray(children) ? children : [children]
  return parts
    .map((part) =>
      typeof part === "string" || typeof part === "number" ? String(part) : "",
    )
    .join("")
}

/** Host Text nodes whose own string children include `needle`. */
function textNodes(renderer: TestInstance, needle: string) {
  return hosts(
    renderer,
    (node) => node.type === "Text" && textOf(node).includes(needle),
  )
}

/** SYNTHETIC: half an em per character, lines 1.35 em apart. */
function modelHeight(text: string, width: number) {
  return (size: number) => {
    const perLine = Math.max(1, Math.floor(width / (size * 0.5)))
    return Math.ceil(text.length / perLine) * Math.round(size * 1.35)
  }
}

const COLUMN_WIDTH = 440 - 2 * 24

/** Answers each measuring copy until the fit settles. */
async function settleFit(
  renderer: TestInstance,
  heightOf: (size: number) => number,
) {
  for (let pass = 0; pass < 4; pass += 1) {
    const copies = hosts(renderer, (node) =>
      String(node.props.testID ?? "").startsWith("bible-verse-measure-"),
    )
    if (copies.length === 0) return
    await act(async () => {
      for (const copy of copies) {
        const size = Number(
          String(copy.props.testID).replace("bible-verse-measure-", ""),
        )
        const onLayout = copy.props.onLayout as (event: unknown) => void
        onLayout({
          nativeEvent: {
            layout: { x: 0, y: 0, width: COLUMN_WIDTH, height: heightOf(size) },
          },
        })
      }
    })
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 25; i += 1) await Promise.resolve()
  })
}

const mounted: TestInstance[] = []

type Callbacks = Pick<
  BibleReaderProps,
  | "onOpenPassagePicker"
  | "onOpenTranslationPicker"
  | "onOpenSettings"
  | "onOpenDownload"
>

function callbacks(): Callbacks & { [K in keyof Callbacks]: jest.Mock } {
  return {
    onOpenPassagePicker: jest.fn(),
    onOpenTranslationPicker: jest.fn(),
    onOpenSettings: jest.fn(),
    onOpenDownload: jest.fn(),
  }
}

async function render(
  services: ReaderServices,
  extra: Partial<BibleReaderProps> = {},
): Promise<TestInstance> {
  const props = {
    host: "tab",
    ...callbacks(),
    services,
    onboardingStore: onboarding,
    ...extra,
  } as BibleReaderProps
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <BibleReader {...props} />
      </StrictMode>,
    )
  })
  mounted.push(renderer)
  await flush()
  return renderer
}

async function openAt(services: ReaderServices, ref: VerseRef) {
  services.positionStore.moveTo(ref)
}

// U8's hint and demo have their own suite (ReaderMovement.test.tsx); here
// both are done, so the U7 geometry and control counts stay as U7 set them.
let onboarding: ReaderOnboardingStore

beforeEach(() => {
  onboarding = createReaderOnboardingStore(
    memoryStorage({
      [READER_ONBOARDING_STORAGE_KEY]: serializeReaderOnboarding({
        hintRetired: true,
        demoPlayed: true,
      }),
    }),
  )
  mockStatusBars.length = 0
  mockFocus.focused = true
  mockWatchPrefs.audioLanguageIso3 = null
  mockWatchPrefs.isReady = true
  act(() => {
    Dimensions.set({ window: WINDOW, screen: WINDOW })
  })
})

afterEach(async () => {
  for (const renderer of mounted.splice(0)) {
    await act(async () => renderer.unmount())
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
  act(() => {
    Dimensions.set({ window: originalWindow, screen: originalWindow })
  })
})

describe("BibleReader — the verse", () => {
  it("covers AE9: a gap verse shows the note and the counter reads 11 / 35", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "MAT", chapter: 18, verse: 11 })
    const renderer = await render(services)

    const note = byTestId(renderer, "bible-missing-verse")
    expect(note).toHaveLength(1)
    expect(textOf(note[0]!)).toBe(READER_COPY.missingVerse(11))
    expect(textNodes(renderer, "11 / 35")).toHaveLength(1)
    // Never a blank screen: no verse, no loading, only the note.
    expect(byTestId(renderer, "bible-verse")).toHaveLength(0)
  })

  it("shows the verse after the fit settles, never before", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 11, verse: 35 })
    const renderer = await render(services)

    const hidden = byTestId(renderer, "bible-verse")
    expect(hidden).toHaveLength(1)
    expect(flat(hidden[0]!).opacity).toBe(0)

    await settleFit(renderer, modelHeight("35 Jesus wept.", COLUMN_WIDTH))
    const shown = byTestId(renderer, "bible-verse")
    expect(flat(shown[0]!).opacity).toBe(1)
    expect(textNodes(renderer, "Jesus wept.").length).toBeGreaterThan(0)
  })

  it("sets allowFontScaling={false} on the verse and on its measuring copies", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    const renderer = await render(services)
    const verseTexts = () =>
      hosts(
        renderer,
        (node) =>
          node.type === "Text" && textOf(node).includes("For God so loved"),
      )

    // The first pass holds the visible verse and one measuring copy.
    expect(verseTexts().length).toBeGreaterThanOrEqual(2)
    for (const node of verseTexts())
      expect(node.props.allowFontScaling).toBe(false)

    await settleFit(renderer, () => 100)
    expect(verseTexts().length).toBeGreaterThanOrEqual(1)
    for (const node of verseTexts())
      expect(node.props.allowFontScaling).toBe(false)
  })

  it("covers AE12: John 11:35 keeps the largest size", async () => {
    const { services } = makeServices()
    const largest = READER_TEXT_SIZE_STEPS.length - 1
    services.settingsStore.update({ textSizeStep: largest })
    await openAt(services, { book: "JHN", chapter: 11, verse: 35 })
    const renderer = await render(services)
    await settleFit(renderer, modelHeight("35 Jesus wept.", COLUMN_WIDTH))

    const [verse] = textNodes(renderer, "Jesus wept.")
    expect(flat(verse!).fontSize).toBe(READER_TEXT_SIZE_STEPS[largest])
    expect(byTestId(renderer, "bible-verse-scroll")).toHaveLength(0)
  })

  it("covers AE12: Esther 8:9 under the window scrolls at the floor", async () => {
    const { services } = makeServices()
    const largest = READER_TEXT_SIZE_STEPS.length - 1
    const chosen = READER_TEXT_SIZE_STEPS[largest]
    services.settingsStore.update({ textSizeStep: largest })
    await openAt(services, { book: "EST", chapter: 8, verse: 9 })
    const window = { y: mockInsets.top + READER_TOP_BAR_HEIGHT, height: 140 }
    const renderer = await render(services, { floatingObstacles: [window] })
    const esther = bundledBook("EST")
    const text =
      esther.status === "ok"
        ? (esther.value.chapters[7]?.verses[8]?.lines ?? [])
            .map((line) => line.text)
            .join(" ")
        : ""
    await settleFit(renderer, modelHeight(`9 ${text}`, COLUMN_WIDTH))

    expect(byTestId(renderer, "bible-verse-scroll")).toHaveLength(1)
    const [verse] = textNodes(renderer, text.slice(0, 30))
    expect(flat(verse!).fontSize).toBe(fitFloor(chosen))
    // No word sits under the window: the whole box is below it.
    const [area] = byTestId(renderer, "bible-verse-area")
    expect(flat(area!).top).toBeGreaterThanOrEqual(window.y + window.height)
  })

  it("shows a merged verse's range in the verse, the pill, and the counter", async () => {
    const { services } = makeServices(async () => ({
      status: "ok",
      text: fixtureText(t4tJohn4),
    }))
    services.positionStore.pickTranslation("eng_t4t")
    await openAt(services, { book: "JHN", chapter: 4, verse: 7 })
    const renderer = await render(services)
    await settleFit(renderer, () => 200)

    const lastVerse = fixtureText(t4tJohn4).chapter.lastVerse
    expect(textNodes(renderer, `6-8 / ${lastVerse}`)).toHaveLength(1)
    expect(
      hosts(
        renderer,
        (node) =>
          node.props.accessibilityLabel ===
          READER_COPY.choosePassage("John 4:6-8"),
      ),
    ).not.toHaveLength(0)
    const numbers = hosts(
      renderer,
      (node) => node.type === "Text" && textOf(node) === "6-8 ",
    )
    expect(numbers.length).toBeGreaterThan(0)
  })

  it("right-aligns a right-to-left translation (R32)", async () => {
    const { services } = makeServices(async () => ({
      status: "ok",
      text: fixtureText(arabicJohn3),
    }))
    services.positionStore.pickTranslation("arb_vdv")
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    const renderer = await render(services)
    await settleFit(renderer, () => 200)

    const lines = hosts(
      renderer,
      (node) =>
        node.type === "Text" && node.props.testID === "bible-verse-line",
    )
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(flat(line).textAlign).toBe("right")
      expect(flat(line).writingDirection).toBe("rtl")
    }
  })

  it("centers a left-to-right verse", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    const renderer = await render(services)
    await settleFit(renderer, () => 200)
    const lines = hosts(
      renderer,
      (node) =>
        node.type === "Text" && node.props.testID === "bible-verse-line",
    )
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(flat(line).textAlign).toBe("center")
  })
})

describe("BibleReader — the verse box", () => {
  // KD27. A tall window in a top corner leaves a small centered box.
  const tallWindow = {
    y: mockInsets.top + READER_TOP_BAR_HEIGHT,
    height: 330,
  }
  const areaOf = (renderer: TestInstance) => {
    const style = flat(byTestId(renderer, "bible-verse-area")[0]!)
    return { top: Number(style.top), height: Number(style.height) }
  }

  it("moves a verse that would scroll into the free space (KD27)", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "EST", chapter: 8, verse: 9 })
    const renderer = await render(services, {
      floatingObstacles: [tallWindow],
    })
    const esther = bundledBook("EST")
    const text =
      esther.status === "ok"
        ? (esther.value.chapters[7]?.verses[8]?.lines ?? [])
            .map((line) => line.text)
            .join(" ")
        : ""
    await settleFit(renderer, modelHeight(`9 ${text}`, COLUMN_WIDTH))

    const area = areaOf(renderer)
    expect(area.top).toBe(tallWindow.y + tallWindow.height + VERSE_BOX_GAP)
    expect(area.top + area.height / 2).toBeGreaterThan(WINDOW.height / 2)
  })

  it("keeps a verse that fits the centered box on the center (KD27)", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 11, verse: 35 })
    const renderer = await render(services, {
      floatingObstacles: [tallWindow],
    })
    await settleFit(renderer, modelHeight("35 Jesus wept.", COLUMN_WIDTH))

    const area = areaOf(renderer)
    expect(area.top + area.height / 2).toBe(WINDOW.height / 2)
  })

  it("shrinks symmetrically under a top band taller than the bottom one", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    // A window in the top-right corner, deeper than the footer band.
    const window = { y: mockInsets.top + READER_TOP_BAR_HEIGHT, height: 260 }
    const renderer = await render(services, { floatingObstacles: [window] })
    const [area] = byTestId(renderer, "bible-verse-area")
    const style = flat(area!)
    const top = Number(style.top)
    const height = Number(style.height)
    expect(top + height / 2).toBe(WINDOW.height / 2)
    expect(top).toBeGreaterThanOrEqual(window.y + window.height)
  })

  it("grows back when the window leaves", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    const props = {
      host: "tab",
      ...callbacks(),
      services,
      onboardingStore: onboarding,
    } as BibleReaderProps
    const window = { y: mockInsets.top + READER_TOP_BAR_HEIGHT, height: 260 }
    const renderer = await render(services, { floatingObstacles: [window] })
    const covered = Number(
      flat(byTestId(renderer, "bible-verse-area")[0]!).height,
    )
    await act(async () => {
      renderer.update(
        <StrictMode>
          <BibleReader {...props} floatingObstacles={[]} />
        </StrictMode>,
      )
    })
    const clear = Number(
      flat(byTestId(renderer, "bible-verse-area")[0]!).height,
    )
    expect(clear).toBeGreaterThan(covered)
  })
})

// U13: the mini player reads this band to rest a bottom corner above it.
describe("BibleReader — the band it publishes for the mini player", () => {
  beforeEach(() => resetReaderMovementBandForTests())
  afterEach(() => resetReaderMovementBandForTests())

  it("publishes no band and then the hint's row while the hint lives", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    onboarding = createReaderOnboardingStore(memoryStorage({}))
    expect(getReaderMovementBand()).toBeNull()

    await render(services)

    expect(getReaderMovementBand()).toBe(
      readerMovementBandHeight({ arrows: false, hint: true }),
    )
  })

  it("publishes the arrow row once the viewer turns the arrows on", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    await render(services)
    // Anti-vacuous: the hint is retired here, so the band starts empty.
    expect(getReaderMovementBand()).toBe(0)

    await act(async () => {
      services.settingsStore.update({ showArrows: true })
    })

    expect(getReaderMovementBand()).toBe(
      readerMovementBandHeight({ arrows: true, hint: false }),
    )
  })
})

describe("BibleReader — loading and failure", () => {
  it("shows the loading indicator for a pending fetch, then the verse", async () => {
    jest.useFakeTimers()
    const pending = deferred<ChapterFetchResult>()
    const { services } = makeServices(() => pending.promise)
    services.positionStore.pickTranslation("eng_t4t")
    await openAt(services, { book: "JHN", chapter: 4, verse: 7 })
    const renderer = await render(services)

    // Quiet: nothing flashes for a fast load.
    expect(byTestId(renderer, "bible-reader-loading")).toHaveLength(0)
    await act(async () => {
      jest.advanceTimersByTime(READER_LOADING_DELAY_MS)
    })
    expect(byTestId(renderer, "bible-reader-loading")).toHaveLength(1)
    // Anti-vacuous for the Reduce Motion case below: motion is on here.
    expect(
      hosts(renderer, (node) => node.type === "ActivityIndicator"),
    ).toHaveLength(1)

    await act(async () =>
      pending.resolve({ status: "ok", text: fixtureText(t4tJohn4) }),
    )
    await flush()
    await settleFit(renderer, () => 200)
    expect(byTestId(renderer, "bible-reader-loading")).toHaveLength(0)
    expect(byTestId(renderer, "bible-verse")).toHaveLength(1)
  })

  it("keeps the loading indicator still with Reduce Motion on", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true)
    jest.useFakeTimers()
    const { services } = makeServices(() => new Promise(() => {}))
    services.positionStore.pickTranslation("eng_t4t")
    await openAt(services, { book: "JHN", chapter: 4, verse: 7 })
    const renderer = await render(services)
    await act(async () => {
      jest.advanceTimersByTime(READER_LOADING_DELAY_MS)
    })
    const [loading] = byTestId(renderer, "bible-reader-loading")
    expect(loading).toBeDefined()
    expect(
      hosts(renderer, (node) => node.type === "ActivityIndicator"),
    ).toHaveLength(0)
    expect(
      hosts(
        renderer,
        (node) => node.props.accessibilityLabel === READER_COPY.loading,
      ).length,
    ).toBeGreaterThan(0)
  })

  it("shows R31's message offline, with a retry and a switch", async () => {
    const { services, fetch } = makeServices()
    services.positionStore.pickTranslation("spa_bes")
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    const renderer = await render(services)

    expect(byTestId(renderer, "bible-reader-message")).toHaveLength(1)
    expect(textNodes(renderer, READER_COPY.failure.offlineTitle)).toHaveLength(
      1,
    )
    const isRetry = (label: string) => label === READER_COPY.failure.retry
    const isSwitch = (label: string) =>
      label === READER_COPY.failure.switchTo("BSB")
    expect(controlHostsLabelled(renderer, isRetry)).toHaveLength(1)
    expect(controlHostsLabelled(renderer, isSwitch)).toHaveLength(1)

    const calls = fetch.mock.calls.length
    await pressControl(renderer, isRetry)
    await flush()
    expect(fetch.mock.calls.length).toBeGreaterThan(calls)

    await pressControl(renderer, isSwitch)
    await flush()
    await settleFit(renderer, () => 200)
    expect(byTestId(renderer, "bible-reader-message")).toHaveLength(0)
    expect(textNodes(renderer, "For God so loved").length).toBeGreaterThan(0)
  })
})

describe("BibleReader — the chrome", () => {
  it("names the translation shown in the fallback label, and a tap opens the picker (R25)", async () => {
    const { services } = makeServices()
    // An NT-only Bible has no Genesis, so the phone language's default shows.
    services.positionStore.pickTranslation("aai_wbt")
    await openAt(services, { book: "GEN", chapter: 1, verse: 1 })
    const handlers = callbacks()
    const renderer = await render(services, handlers)

    expect(textNodes(renderer, READER_COPY.shownIn("BSB"))).toHaveLength(1)
    const namesShown = (label: string) =>
      label.includes("Berean Standard Bible") &&
      label.includes("Change translation")
    const [label] = controlHostsLabelled(renderer, namesShown)
    expect(controlHostsLabelled(renderer, namesShown)).toHaveLength(1)
    // It also says whose book is missing.
    expect(String(label!.props.accessibilityLabel)).toContain(
      "TUR GEWASIN O BAIBASIT BOUBUN",
    )
    await pressControl(renderer, namesShown)
    expect(handlers.onOpenTranslationPicker).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenTranslationPicker.mock.calls[0]?.[0]).toMatchObject({
      translation: { id: "BSB" },
      translationRef: { book: "GEN", chapter: 1, verse: 1 },
    })
  })

  it("renders the back button on the pushed host only", async () => {
    const tab = makeServices()
    const tabReader = await render(tab.services)
    expect(
      hosts(
        tabReader,
        (node) => node.props.accessibilityLabel === READER_COPY.back,
      ),
    ).toHaveLength(0)

    const onBack = jest.fn()
    const pushed = makeServices()
    const pushedReader = await render(pushed.services, {
      host: "pushed",
      onBack,
    } as Partial<BibleReaderProps>)
    const isBack = (label: string) => label === READER_COPY.back
    expect(controlHostsLabelled(pushedReader, isBack)).toHaveLength(1)
    await pressControl(pushedReader, isBack)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it("gives every control a label and a 44 x 44 hit area (R36)", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    const renderer = await render(services, {
      host: "pushed",
      onBack: jest.fn(),
    } as Partial<BibleReaderProps>)
    await settleFit(renderer, () => 200)

    const controls = controlHosts(renderer)
    // Back, pill, download, settings, translation label.
    expect(controls).toHaveLength(5)
    for (const control of controls) {
      expect(
        String(control.props.accessibilityLabel ?? "").length,
      ).toBeGreaterThan(0)
      const style = flat(control)
      expect(Number(style.minWidth ?? style.width)).toBeGreaterThanOrEqual(
        READER_TOUCH_TARGET,
      )
      expect(Number(style.minHeight ?? style.height)).toBeGreaterThanOrEqual(
        READER_TOUCH_TARGET,
      )
    }
  })

  it("wires the pill, the settings, and the download buttons", async () => {
    const { services } = makeServices()
    await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
    const handlers = callbacks()
    const renderer = await render(services, handlers)
    const press = (label: string) =>
      pressControl(renderer, (item) => item === label)
    await press(READER_COPY.choosePassage("John 3:16"))
    await press(READER_COPY.settings)
    await press(READER_COPY.download.onDevice("Berean Standard Bible"))
    expect(handlers.onOpenPassagePicker).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenDownload).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenDownload.mock.calls[0]?.[0]).toMatchObject({
      translation: { id: "BSB" },
    })
  })

  it("credits Still in the footer", async () => {
    const { services } = makeServices()
    const renderer = await render(services)
    expect(textNodes(renderer, READER_COPY.stillCredit)).toHaveLength(1)
  })

  it("renders the status bar override only while the screen has focus", async () => {
    const { services } = makeServices()
    services.settingsStore.update({ mode: "light" })
    const renderer = await render(services)
    expect(mockStatusBars).toContain("dark")

    mockStatusBars.length = 0
    mockFocus.focused = false
    await act(async () => {
      renderer.update(
        <StrictMode>
          <BibleReader
            host="tab"
            {...callbacks()}
            services={services}
            onboardingStore={onboarding}
          />
        </StrictMode>,
      )
    })
    expect(mockStatusBars).toHaveLength(0)
  })
})

describe("BibleReader — the pushed reader's start (U11, AE15)", () => {
  const JOHN_3_16: VerseRef = { book: "JHN", chapter: 3, verse: 16 }
  const GENESIS_1_1: VerseRef = { book: "GEN", chapter: 1, verse: 1 }
  const ROMANS_8_28: VerseRef = { book: "ROM", chapter: 8, verse: 28 }

  const pills = (renderer: TestInstance, passage: string) =>
    controlHostsLabelled(
      renderer,
      (label) => label === READER_COPY.choosePassage(passage),
    )

  const saved = (ref: VerseRef) =>
    serializeReadingPosition({ ref, translationId: null })

  function pushed(
    services: ReaderServices,
    startRef: VerseRef | null,
  ): BibleReaderProps {
    return {
      host: "pushed",
      source: "quote",
      onBack: jest.fn(),
      startRef,
      ...callbacks(),
      services,
      onboardingStore: onboarding,
    }
  }

  it("opens at its start reference and moves the shared position", async () => {
    const { services } = makeServices()
    services.positionStore = createReadingPositionStore(
      memoryStorage({ [READING_POSITION_STORAGE_KEY]: saved(GENESIS_1_1) }),
    )
    await services.positionStore.hydrate()
    expect(services.positionStore.getSnapshot().ref).toEqual(GENESIS_1_1)

    const renderer = await render(services, pushed(services, JOHN_3_16))
    expect(pills(renderer, "John 3:16")).toHaveLength(1)
    expect(services.positionStore.getSnapshot().ref).toEqual(JOHN_3_16)
  })

  it("covers AE15: a saved position that loads late does not move it", async () => {
    const { services } = makeServices()
    const read = deferred<string | null>()
    services.positionStore = createReadingPositionStore({
      getItem: () => read.promise,
      setItem: async () => {},
    })
    const renderer = await render(services, pushed(services, JOHN_3_16))
    expect(pills(renderer, "John 3:16")).toHaveLength(1)

    await act(async () => read.resolve(saved(GENESIS_1_1)))
    await flush()
    expect(pills(renderer, "John 3:16")).toHaveLength(1)
    expect(services.positionStore.getSnapshot()).toMatchObject({
      status: "ready",
      ref: JOHN_3_16,
    })
  })

  it("never writes the store during a render while the Bible tab reads it", async () => {
    // U5: the tab subscribes first, as it does under a pushed reader. A
    // write in the pushed reader's render would update the tab mid-render.
    const errors = jest.spyOn(console, "error")
    const { services } = makeServices()
    const tab = (
      <BibleReader
        host="tab"
        {...callbacks()}
        services={services}
        onboardingStore={onboarding}
      />
    )
    const renderer = await render(services)
    await act(async () => {
      renderer.update(<StrictMode>{tab}</StrictMode>)
    })
    await flush()
    await act(async () => {
      renderer.update(
        <StrictMode>
          {tab}
          <BibleReader {...pushed(services, ROMANS_8_28)} />
        </StrictMode>,
      )
    })
    await flush()

    // KD2: both hosts show the one position.
    expect(pills(renderer, "Romans 8:28")).toHaveLength(2)
    const renderWrites = errors.mock.calls.filter((args) =>
      String(args[0]).includes("Cannot update a component"),
    )
    expect(renderWrites).toHaveLength(0)
  })

  it("follows the shared position once the start is saved", async () => {
    const { services } = makeServices()
    const renderer = await render(services, pushed(services, JOHN_3_16))
    await act(async () => {
      services.positionStore.moveTo(ROMANS_8_28)
    })
    await flush()
    expect(pills(renderer, "Romans 8:28")).toHaveLength(1)
  })

  it("moves to a new start when the route's params change", async () => {
    const { services } = makeServices()
    const renderer = await render(services, pushed(services, JOHN_3_16))
    await act(async () => {
      renderer.update(
        <StrictMode>
          <BibleReader {...pushed(services, ROMANS_8_28)} />
        </StrictMode>,
      )
    })
    await flush()
    expect(pills(renderer, "Romans 8:28")).toHaveLength(1)
    expect(services.positionStore.getSnapshot().ref).toEqual(ROMANS_8_28)
  })

  it("keeps the saved position when there is no start reference", async () => {
    const { services } = makeServices()
    services.positionStore = createReadingPositionStore(
      memoryStorage({ [READING_POSITION_STORAGE_KEY]: saved(GENESIS_1_1) }),
    )
    const renderer = await render(services, pushed(services, null))
    expect(pills(renderer, "Genesis 1:1")).toHaveLength(1)
    expect(services.positionStore.getSnapshot().ref).toEqual(GENESIS_1_1)
  })
})

// U14, R37: one open and one end per visit, under StrictMode. A visit runs
// from focus to blur; a round trip to the reader's own sheet stays one visit.
describe("BibleReader — reader visits (U14, KTD18)", () => {
  const JOHN_3_16: VerseRef = { book: "JHN", chapter: 3, verse: 16 }
  const JOHN_3_17: VerseRef = { book: "JHN", chapter: 3, verse: 17 }
  const info = datadogLog.info as unknown as jest.Mock

  function sent(name: string) {
    return info.mock.calls
      .filter(([event]) => event === name)
      .map(([, context]) => context as Record<string, unknown>)
  }

  beforeEach(() => info.mockClear())

  async function focus(
    renderer: TestInstance,
    props: BibleReaderProps,
    focused: boolean,
  ) {
    mockFocus.focused = focused
    await act(async () => {
      renderer.update(
        <StrictMode>
          <BibleReader {...props} />
        </StrictMode>,
      )
    })
    await flush()
  }

  function tabProps(services: ReaderServices): BibleReaderProps {
    return {
      host: "tab",
      ...callbacks(),
      services,
      onboardingStore: onboarding,
    }
  }

  function pushedProps(
    services: ReaderServices,
    source: "quote" | "link",
  ): BibleReaderProps {
    return {
      host: "pushed",
      source,
      onBack: jest.fn(),
      startRef: JOHN_3_16,
      ...callbacks(),
      services,
      onboardingStore: onboarding,
    }
  }

  it("logs one tab open, and the blur ends the visit with its verse count", async () => {
    const { services } = makeServices()
    await openAt(services, JOHN_3_16)
    const props = tabProps(services)
    const renderer = await render(services, props)
    expect(sent("bible_reader.opened")).toEqual([{ reader_source: "tab" }])

    await act(async () => {
      services.positionStore.moveTo(JOHN_3_17)
    })
    await flush()
    await focus(renderer, props, false)

    expect(sent("bible_reader.visit_ended")).toEqual([
      { reader_source: "tab", reader_verse_count: 2 },
    ])
  })

  it("logs a quote open, and keeps one visit across a round trip to a sheet", async () => {
    const { services } = makeServices()
    const props = pushedProps(services, "quote")
    const renderer = await render(services, props)
    expect(sent("bible_reader.opened")).toEqual([{ reader_source: "quote" }])

    await pressControl(
      renderer,
      (label) => label === READER_COPY.choosePassage("John 3:16"),
    )
    await focus(renderer, props, false)
    await focus(renderer, props, true)
    expect(sent("bible_reader.opened")).toHaveLength(1)
    expect(sent("bible_reader.visit_ended")).toHaveLength(0)

    await focus(renderer, props, false)
    expect(sent("bible_reader.visit_ended")).toEqual([
      { reader_source: "quote", reader_verse_count: 1 },
    ])
  })

  it("ends the visit at a blur after the download prompt, which is no sheet", async () => {
    const { services } = makeServices()
    await openAt(services, JOHN_3_16)
    const props = tabProps(services)
    const renderer = await render(services, props)
    await pressControl(
      renderer,
      (label) =>
        label === READER_COPY.download.onDevice("Berean Standard Bible"),
    )
    await focus(renderer, props, false)
    expect(sent("bible_reader.visit_ended")).toHaveLength(1)
  })

  it("ends the visit once when a pushed link reader unmounts", async () => {
    const { services } = makeServices()
    const renderer = await render(services, pushedProps(services, "link"))
    expect(sent("bible_reader.opened")).toEqual([{ reader_source: "link" }])

    await act(async () => renderer.unmount())
    mounted.splice(mounted.indexOf(renderer), 1)
    await flush()
    expect(sent("bible_reader.visit_ended")).toEqual([
      { reader_source: "link", reader_verse_count: 1 },
    ])
  })

  it("sends no verse text in any context", async () => {
    const { services } = makeServices()
    await openAt(services, JOHN_3_16)
    const props = tabProps(services)
    const renderer = await render(services, props)
    await settleFit(renderer, () => 200)
    expect(textNodes(renderer, "For God so loved")).toHaveLength(1)
    await focus(renderer, props, false)

    expect(info.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const [, context] of info.mock.calls) {
      const values = Object.values(context as Record<string, unknown>)
      for (const value of values) {
        expect(["string", "number"]).toContain(typeof value)
      }
      expect(JSON.stringify(context)).not.toMatch(/loved|world/i)
    }
  })
})

describe("BibleReader — theme read from the rendered tree", () => {
  const PAIRS = READER_PALETTES.flatMap((palette) =>
    READER_SCHEMES.map((scheme) => [palette, scheme] as const),
  )

  it.each(PAIRS)(
    "%s %s: the verse and the footer clear 4.5:1 on the page",
    async (palette, scheme) => {
      const { services } = makeServices()
      services.settingsStore.update({ palette, mode: scheme })
      await openAt(services, { book: "JHN", chapter: 3, verse: 16 })
      const renderer = await render(services)
      await settleFit(renderer, () => 200)

      const [root] = byTestId(renderer, "bible-reader")
      const page = String(flat(root!).backgroundColor)
      const [verse] = textNodes(renderer, "For God so loved")
      const [counter] = textNodes(renderer, "16 / 36")
      const [credit] = textNodes(renderer, READER_COPY.stillCredit)
      // The property, not one variant's node: every text is judged on the page.
      for (const node of [verse, counter, credit]) {
        expect(node).toBeDefined()
        expect(
          contrastRatio(String(flat(node!).color), page),
        ).toBeGreaterThanOrEqual(4.5)
      }
      expect(page).toBe(readerTokens(palette, scheme).background)
    },
  )
})
