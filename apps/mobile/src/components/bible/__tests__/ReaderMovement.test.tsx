// U8 (feat-551 KTD13, KTD14, KTD19) and U9 (R18, R19) over the real stores
// and U4 repository. Each render is in <StrictMode>, swipes and scrubs drive
// the REAL PanResponder handlers, and a case finishes each held animation.

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
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }))
const mockFocus = { focused: true }
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocus.focused }))
const mockInsets = { top: 62, bottom: 34, left: 0, right: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
jest.mock("../../../contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => ({ audioLanguageIso3: null, isReady: true }),
}))
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
}))

import { StrictMode, act } from "react"
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Dimensions,
  Share,
  StyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native"
import * as Clipboard from "expo-clipboard"

import t4tJohn4 from "../../../lib/bible/text/__tests__/fixtures/eng_t4t-jhn-4.json"
import synodalPsalm50 from "../../../lib/bible/text/__tests__/fixtures/rus_syn-psa-50.json"
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
  type ReaderOnboarding,
  type ReaderOnboardingStore,
} from "../../../lib/bible/onboarding/store"
import { createReadingPositionStore } from "../../../lib/bible/position/store"
import type { ChapterCache } from "../../../lib/bible/repository/chapterCache"
import type {
  ChapterAddress,
  ChapterFetchResult,
} from "../../../lib/bible/repository/fetchChapter"
import { createChapterRepository } from "../../../lib/bible/repository/resolveChapter"
import type { TranslationDownloadState } from "../../../lib/bible/repository/translationDownloads"
import { createReaderSettingsStore } from "../../../lib/bible/settings/store"
import {
  READER_SETTINGS_STORAGE_KEY,
  serializeReaderSettings,
  DEFAULT_READER_SETTINGS,
  READER_TEXT_SIZE_STEPS,
} from "../../../lib/bible/settings/snapshot"
import type { UsfmBookId } from "../../../lib/bible/text/books"
import {
  normalizeChapterFile,
  parseBookText,
} from "../../../lib/bible/text/normalize"
import type { BookText } from "../../../lib/bible/text/types"
import type { VerseRef } from "../../../lib/bible/versification/convert"
import { READER_COPY } from "../../../lib/bible/reader/copy"
import {
  READER_TOP_BAR_HEIGHT,
  READER_TOUCH_TARGET,
} from "../../../lib/bible/reader/chrome"
import type { ReaderServices } from "../../../lib/bible/reader/services"
import { BACK_SWIPE_EDGE_WIDTH } from "../../../lib/backSwipe"
import { BibleReader, type BibleReaderProps } from "../BibleReader"
import { CHAPTER_FLASH_MS, CHAPTER_PULSE_MS } from "../ChapterPill"
import { SWIPE_DEMO_DELAY_MS, SWIPE_DEMO_MS } from "../SwipeDemo"
import { SWIPE_HINT_MS } from "../SwipeHint"

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

function memoryStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed))
  return {
    items,
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
  settings: Partial<typeof DEFAULT_READER_SETTINGS> = {},
): ReaderServices {
  const bundled: TranslationDownloadState = { kind: "bundled" }
  const notDownloaded: TranslationDownloadState = { kind: "not-downloaded" }
  const downloads = {
    check: async () => {},
    getState: (id: string): TranslationDownloadState =>
      id === "BSB" ? bundled : notDownloaded,
    subscribe: () => () => {},
    readBook: async () => null,
  }
  return {
    repository: createChapterRepository({
      loadBundledBook: async (bookId) => bundledBook(bookId),
      downloads,
      cache: memoryCache,
      fetchChapter,
    }),
    downloads,
    loadCatalog: async () => ({ status: "ok", value: CATALOG }),
    positionStore: createReadingPositionStore(memoryStorage()),
    settingsStore: createReaderSettingsStore(
      memoryStorage({
        [READER_SETTINGS_STORAGE_KEY]: serializeReaderSettings({
          ...DEFAULT_READER_SETTINGS,
          ...settings,
        }),
      }),
    ),
    readPhoneLanguage: () => "en",
  }
}

/** A store whose saved flags read back as `flags`. */
function onboardingStore(
  flags: ReaderOnboarding,
  storage = memoryStorage({
    [READER_ONBOARDING_STORAGE_KEY]: serializeReaderOnboarding(flags),
  }),
): ReaderOnboardingStore {
  return createReaderOnboardingStore(storage)
}

/** Most cases: the demo is done and the hint is still live. */
const AFTER_DEMO: ReaderOnboarding = { hintRetired: false, demoPlayed: true }
const SETTLED: ReaderOnboarding = { hintRetired: true, demoPlayed: true }

// iPhone 17 Pro Max, and an 11-inch iPad.
const PHONE = { width: 440, height: 956, scale: 3, fontScale: 1 }
const TABLET = { width: 820, height: 1180, scale: 2, fontScale: 1 }
const originalWindow = Dimensions.get("window")
const MIDDLE = { x: PHONE.width / 2, y: PHONE.height / 2 }

// Held animations: a case finishes them by hand.
type TimingCall = {
  config: Animated.TimingAnimationConfig
  finish: () => void
  started: boolean
}
let timings: TimingCall[] = []

function timingsWith(match: Partial<Animated.TimingAnimationConfig>) {
  return timings.filter(
    (call) =>
      call.started &&
      Object.entries(match).every(
        ([key, value]) =>
          call.config[key as keyof Animated.TimingAnimationConfig] === value,
      ),
  )
}

async function finishTimings(match: Partial<Animated.TimingAnimationConfig>) {
  await act(async () => {
    for (const call of timingsWith(match)) call.finish()
  })
}

let screenReader = false
let reduceMotion = false
let announcements: string[] = []

function flat(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}
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

function textOf(node: RenderedNode): string {
  const { children } = node.props
  const parts = Array.isArray(children) ? children : [children]
  return parts
    .map((part) =>
      typeof part === "string" || typeof part === "number" ? String(part) : "",
    )
    .join("")
}

function textNodes(renderer: TestInstance, needle: string) {
  return hosts(
    renderer,
    (node) => node.type === "Text" && textOf(node).includes(needle),
  )
}

/** The pill's reference: its label is "<passage>. Choose a passage". */
function pillPassage(renderer: TestInstance): string | null {
  const [pill] = hosts(
    renderer,
    (node) =>
      node.props.accessibilityRole === "button" &&
      String(node.props.accessibilityLabel ?? "").endsWith(
        ". Choose a passage",
      ),
  )
  const label = pill ? String(pill.props.accessibilityLabel) : null
  return label ? label.replace(". Choose a passage", "") : null
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 25; i += 1) await Promise.resolve()
  })
}

/** Answers the fit's measuring copies, so the verse shows. */
async function settleFit(renderer: TestInstance, height = 200) {
  for (let pass = 0; pass < 4; pass += 1) {
    const copies = hosts(renderer, (node) =>
      String(node.props.testID ?? "").startsWith("bible-verse-measure-"),
    )
    if (copies.length === 0) return
    await act(async () => {
      for (const copy of copies) {
        const onLayout = copy.props.onLayout as (event: unknown) => void
        onLayout({
          nativeEvent: { layout: { x: 0, y: 0, width: 392, height } },
        })
      }
    })
  }
}

const mounted: TestInstance[] = []

type RenderOptions = {
  onboarding?: ReaderOnboardingStore
  extra?: Partial<BibleReaderProps>
  /** The measured text height; a large one forces the scroll fit. */
  fitHeight?: number
}

async function render(
  services: ReaderServices,
  options: RenderOptions = {},
): Promise<TestInstance> {
  const props = {
    host: "tab",
    onOpenPassagePicker: jest.fn(),
    onOpenTranslationPicker: jest.fn(),
    onOpenSettings: jest.fn(),
    onOpenDownload: jest.fn(),
    services,
    onboardingStore: options.onboarding ?? onboardingStore(AFTER_DEMO),
    ...options.extra,
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
  await settleFit(renderer, options.fitHeight)
  return renderer
}

async function openAt(
  ref: VerseRef,
  options: RenderOptions & { services?: ReaderServices } = {},
) {
  const services = options.services ?? makeServices()
  services.positionStore.moveTo(ref)
  const renderer = await render(services, options)
  return { services, renderer }
}

// ── Touches, as the responder system dispatches them ────────────────────────

type Point = { x: number; y: number }

let touchClock = 1000
function touch(
  current: Point,
  previous: Point,
  starting = false,
): GestureResponderEvent {
  touchClock += 16
  const nativeTouch = { pageX: current.x, pageY: current.y }
  return {
    nativeEvent: {
      ...nativeTouch,
      touches: starting ? [nativeTouch] : [],
      changedTouches: [nativeTouch],
    },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: touchClock,
      touchBank: [
        {
          touchActive: true,
          startPageX: previous.x,
          startPageY: previous.y,
          startTimeStamp: touchClock - 32,
          currentPageX: current.x,
          currentPageY: current.y,
          currentTimeStamp: touchClock,
          previousPageX: previous.x,
          previousPageY: previous.y,
          previousTimeStamp: touchClock - 16,
        },
      ],
    },
  } as unknown as GestureResponderEvent
}

type PanHandlers = {
  onStartShouldSetResponderCapture: (e: GestureResponderEvent) => boolean
  onMoveShouldSetResponderCapture: (e: GestureResponderEvent) => boolean
  onResponderGrant: (e: GestureResponderEvent) => void
  onResponderMove: (e: GestureResponderEvent) => void
  onResponderRelease: (e: GestureResponderEvent) => void
}

function gestureHandlers(renderer: TestInstance): PanHandlers {
  const [layer] = byTestId(renderer, "bible-reader-gestures")
  expect(layer).toBeDefined()
  return layer!.props as unknown as PanHandlers
}

/** Starts a drag; null when the reader declines it. */
async function beginSwipe(renderer: TestInstance, from: Point, to: Point) {
  const handlers = gestureHandlers(renderer)
  const claimAt = {
    x: from.x + (to.x - from.x) / 4,
    y: from.y + (to.y - from.y) / 4,
  }
  handlers.onStartShouldSetResponderCapture(touch(from, from, true))
  let claimed = false
  await act(async () => {
    claimed = handlers.onMoveShouldSetResponderCapture(touch(claimAt, from))
  })
  if (!claimed) return null
  await act(async () => {
    handlers.onResponderGrant(touch(claimAt, claimAt))
    handlers.onResponderMove(touch(to, claimAt))
  })
  return {
    release: async () => {
      await act(async () => handlers.onResponderRelease(touch(to, to)))
      await flush()
      await settleFit(renderer)
    },
  }
}

async function swipe(renderer: TestInstance, from: Point, to: Point) {
  const drag = await beginSwipe(renderer, from, to)
  if (!drag) return false
  await drag.release()
  return true
}

const UP = { from: MIDDLE, to: { x: MIDDLE.x, y: MIDDLE.y - 120 } }
const DOWN = { from: MIDDLE, to: { x: MIDDLE.x, y: MIDDLE.y + 120 } }
const LEFT = { from: MIDDLE, to: { x: MIDDLE.x - 140, y: MIDDLE.y } }
const RIGHT = { from: MIDDLE, to: { x: MIDDLE.x + 140, y: MIDDLE.y } }

const swipeUp = (r: TestInstance) => swipe(r, UP.from, UP.to)
const swipeDown = (r: TestInstance) => swipe(r, DOWN.from, DOWN.to)
const swipeLeft = (r: TestInstance) => swipe(r, LEFT.from, LEFT.to)
const swipeRight = (r: TestInstance) => swipe(r, RIGHT.from, RIGHT.to)

beforeEach(() => {
  timings = []
  mockFocus.focused = true
  screenReader = false
  reduceMotion = false
  announcements = []
  jest.spyOn(Animated, "timing").mockImplementation((_value, config) => {
    let callback: Animated.EndCallback | undefined
    let done = false
    const call: TimingCall = {
      config,
      started: false,
      finish: () => {
        if (done) return
        done = true
        callback?.({ finished: true })
      },
    }
    timings.push(call)
    return {
      start: (cb?: Animated.EndCallback) => {
        call.started = true
        callback = cb
      },
      stop: () => {
        if (done) return
        done = true
        callback?.({ finished: false })
      },
      reset: () => {},
    } as unknown as Animated.CompositeAnimation
  })
  jest
    .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
    .mockImplementation(async () => screenReader)
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockImplementation(async () => reduceMotion)
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation((text: string) => {
      announcements.push(text)
    })
  act(() => {
    Dimensions.set({ window: PHONE, screen: PHONE })
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

// ── Swipes ──────────────────────────────────────────────────────────────────

describe("swipes (R12, R14, KTD13)", () => {
  it("covers AE8: a swipe up at John 3:36 opens John 4:1, saves it once, and animates the pill", async () => {
    const { services, renderer } = await openAt({
      book: "JHN",
      chapter: 3,
      verse: 36,
    })
    const moveTo = jest.spyOn(services.positionStore, "moveTo")
    expect(pillPassage(renderer)).toBe("John 3:36")

    expect(await swipeUp(renderer)).toBe(true)

    expect(pillPassage(renderer)).toBe("John 4:1")
    expect(moveTo).toHaveBeenCalledTimes(1)
    expect(moveTo).toHaveBeenCalledWith({ book: "JHN", chapter: 4, verse: 1 })
    expect(
      timingsWith({ duration: CHAPTER_PULSE_MS, useNativeDriver: true }),
    ).toHaveLength(1)
    expect(announcements).toContain(
      READER_COPY.movement.chapterOpened("John 4"),
    )
  })

  it("covers AE8: a swipe up at Revelation 22:21 stays and says no verse follows", async () => {
    const { services, renderer } = await openAt({
      book: "REV",
      chapter: 22,
      verse: 21,
    })
    const moveTo = jest.spyOn(services.positionStore, "moveTo")
    await swipeUp(renderer)

    expect(pillPassage(renderer)).toBe("Revelation 22:21")
    expect(moveTo).not.toHaveBeenCalled()
    expect(textNodes(renderer, READER_COPY.movement.noVerseAfter)).toHaveLength(
      1,
    )
    expect(announcements).toContain(READER_COPY.movement.noVerseAfter)
    expect(timingsWith({ duration: CHAPTER_PULSE_MS })).toHaveLength(0)
  })

  it("says no verse comes before Genesis 1:1", async () => {
    const { renderer } = await openAt({ book: "GEN", chapter: 1, verse: 1 })
    await swipeDown(renderer)
    expect(pillPassage(renderer)).toBe("Genesis 1:1")
    expect(
      textNodes(renderer, READER_COPY.movement.noVerseBefore),
    ).toHaveLength(1)
  })

  it("moves back from John 4:1 to John 3:36", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 4, verse: 1 })
    await swipeDown(renderer)
    expect(pillPassage(renderer)).toBe("John 3:36")
  })

  it("moves to the next chapter on a swipe left and the previous on a swipe right", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await swipeLeft(renderer)
    expect(pillPassage(renderer)).toBe("John 4:1")
    await swipeRight(renderer)
    expect(pillPassage(renderer)).toBe("John 3:1")
    expect(timingsWith({ duration: CHAPTER_PULSE_MS })).toHaveLength(2)
  })

  it("passes through the Matthew 18:11 note (R21)", async () => {
    const { renderer } = await openAt({ book: "MAT", chapter: 18, verse: 10 })
    await swipeUp(renderer)
    expect(byTestId(renderer, "bible-missing-verse")).toHaveLength(1)
    expect(textNodes(renderer, "11 / 35")).toHaveLength(1)
    await swipeUp(renderer)
    expect(pillPassage(renderer)).toBe("Matthew 18:12")
  })

  it("moves over T4T John 4:6-8 in one move", async () => {
    const services = makeServices(async () => ({
      status: "ok",
      text: fixtureText(t4tJohn4),
    }))
    services.positionStore.pickTranslation("eng_t4t")
    const { renderer } = await openAt(
      { book: "JHN", chapter: 4, verse: 5 },
      { services },
    )
    await swipeUp(renderer)
    expect(pillPassage(renderer)).toBe("John 4:6-8")
    await swipeUp(renderer)
    expect(pillPassage(renderer)).toBe("John 4:9")
  })

  it("shows a Synodal title stop that BSB lacks, and keeps the BSB anchor (R38, R42)", async () => {
    const text = fixtureText(synodalPsalm50)
    const services = makeServices(async () => ({ status: "ok", text }))
    services.positionStore.pickTranslation("rus_syn")
    const { renderer } = await openAt(
      { book: "PSA", chapter: 51, verse: 1 },
      { services },
    )
    expect(pillPassage(renderer)).toBe(`${text.bookName} 50:3`)
    const moveTo = jest.spyOn(services.positionStore, "moveTo")

    await swipeDown(renderer)
    expect(pillPassage(renderer)).toBe(`${text.bookName} 50:2`)
    expect(moveTo).toHaveBeenLastCalledWith({
      book: "PSA",
      chapter: 51,
      verse: 1,
    })
    await swipeDown(renderer)
    expect(pillPassage(renderer)).toBe(`${text.bookName} 50:1`)
    await swipeUp(renderer)
    await swipeUp(renderer)
    expect(pillPassage(renderer)).toBe(`${text.bookName} 50:3`)
  })

  it("shows the destination chapter during a chapter swipe (R13)", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    const drag = await beginSwipe(renderer, LEFT.from, LEFT.to)
    expect(drag).not.toBeNull()
    const preview = byTestId(renderer, "bible-chapter-preview")
    expect(preview).toHaveLength(1)
    expect(textNodes(renderer, "John 4")).not.toHaveLength(0)
    await drag!.release()
    expect(byTestId(renderer, "bible-chapter-preview")).toHaveLength(0)
  })

  it("says no chapter comes before during a swipe right at Genesis 1 (R13)", async () => {
    const { renderer } = await openAt({ book: "GEN", chapter: 1, verse: 5 })
    const drag = await beginSwipe(renderer, RIGHT.from, RIGHT.to)
    expect(
      textNodes(renderer, READER_COPY.movement.noChapterBefore),
    ).toHaveLength(1)
    await drag!.release()
    expect(pillPassage(renderer)).toBe("Genesis 1:5")
  })

  it("declines a pushed-reader swipe that starts in the left strip, the top bar, or the footer", async () => {
    const { services, renderer } = await openAt(
      { book: "JHN", chapter: 3, verse: 16 },
      { extra: { host: "pushed", onBack: jest.fn() } },
    )
    const moveTo = jest.spyOn(services.positionStore, "moveTo")
    const strip = { x: BACK_SWIPE_EDGE_WIDTH - 4, y: MIDDLE.y }
    expect(await swipe(renderer, strip, { x: strip.x + 160, y: strip.y })).toBe(
      false,
    )
    const topBar = {
      x: MIDDLE.x,
      y: mockInsets.top + READER_TOP_BAR_HEIGHT - 4,
    }
    expect(
      await swipe(renderer, topBar, { x: topBar.x - 160, y: topBar.y }),
    ).toBe(false)
    const footer = { x: MIDDLE.x, y: PHONE.height - mockInsets.bottom - 10 }
    expect(
      await swipe(renderer, footer, { x: footer.x, y: footer.y - 160 }),
    ).toBe(false)
    expect(moveTo).not.toHaveBeenCalled()
    // Anti-vacuous: the same drag from inside the screen moves.
    expect(
      await swipe(
        renderer,
        { x: BACK_SWIPE_EDGE_WIDTH + 4, y: MIDDLE.y },
        { x: BACK_SWIPE_EDGE_WIDTH + 164, y: MIDDLE.y },
      ),
    ).toBe(true)
    expect(pillPassage(renderer)).toBe("John 2:1")
  })

  it("leaves a vertical drag to a long verse's scroll view until it reaches the bottom", async () => {
    const services = makeServices(undefined, {
      textSizeStep: READER_TEXT_SIZE_STEPS.length - 1,
    })
    const window = { y: mockInsets.top + READER_TOP_BAR_HEIGHT, height: 140 }
    const { renderer } = await openAt(
      { book: "EST", chapter: 8, verse: 9 },
      { services, extra: { floatingObstacles: [window] }, fitHeight: 5000 },
    )
    const [scroll] = byTestId(renderer, "bible-verse-scroll")
    expect(scroll).toBeDefined()

    expect(await swipeUp(renderer)).toBe(false)
    expect(pillPassage(renderer)).toBe("Esther 8:9")

    await act(async () => {
      const onScroll = scroll!.props.onScroll as (event: unknown) => void
      onScroll({
        nativeEvent: {
          contentOffset: { x: 0, y: 4800 },
          contentSize: { width: 392, height: 5000 },
          layoutMeasurement: { width: 392, height: 200 },
        },
      })
    })
    expect(await swipeUp(renderer)).toBe(true)
    expect(pillPassage(renderer)).toBe("Esther 8:10")
  })
})

// ── Screen readers ──────────────────────────────────────────────────────────

describe("the screen reader's verse control (KTD14, R36)", () => {
  function verseControl(renderer: TestInstance) {
    const [control] = hosts(
      renderer,
      (node) =>
        node.props.accessibilityRole === "adjustable" &&
        typeof node.props.onAccessibilityAction === "function",
    )
    expect(control).toBeDefined()
    return control!
  }

  async function act11y(renderer: TestInstance, actionName: string) {
    const control = verseControl(renderer)
    await act(async () => {
      ;(control.props.onAccessibilityAction as (event: unknown) => void)({
        nativeEvent: { actionName },
      })
    })
    await flush()
    await settleFit(renderer)
  }

  it("reads the verse, the total, and the chapter, and offers chapter actions", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    const control = verseControl(renderer)
    expect(control.props.testID).toBe("bible-verse")
    expect(control.props.accessibilityValue).toEqual({
      text: READER_COPY.movement.verseValue(16, 16, 36, "John 3"),
    })
    const names = (
      control.props.accessibilityActions as { name: string; label?: string }[]
    ).map((action) => action.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "increment",
        "decrement",
        "nextChapter",
        "previousChapter",
      ]),
    )
  })

  it("increments across a chapter end and announces the chapter", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 36 })
    await act11y(renderer, "increment")
    expect(pillPassage(renderer)).toBe("John 4:1")
    expect(announcements).toContain(
      READER_COPY.movement.chapterOpened("John 4"),
    )
    await act11y(renderer, "decrement")
    expect(pillPassage(renderer)).toBe("John 3:36")
  })

  it("opens the next and the previous chapter from its chapter actions", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await act11y(renderer, "nextChapter")
    expect(pillPassage(renderer)).toBe("John 4:1")
    await act11y(renderer, "previousChapter")
    expect(pillPassage(renderer)).toBe("John 3:1")
  })

  it("makes the Matthew 18:11 note adjustable too", async () => {
    const { renderer } = await openAt({ book: "MAT", chapter: 18, verse: 11 })
    const control = verseControl(renderer)
    expect(control.props.testID).toBe("bible-missing-verse")
    await act11y(renderer, "increment")
    expect(pillPassage(renderer)).toBe("Matthew 18:12")
  })
})

// ── The arrow pair ─────────────────────────────────────────────────────────

describe("the arrow pair (R11, AE6)", () => {
  const arrows = (renderer: TestInstance) =>
    byTestId(renderer, "bible-arrow-pair")

  it("covers AE6: hidden on a phone with no screen reader and the setting off", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    expect(arrows(renderer)).toHaveLength(0)
  })

  it("covers AE6: shown on a phone while a screen reader is on", async () => {
    screenReader = true
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    expect(arrows(renderer)).toHaveLength(1)
  })

  it("covers AE6: shown on a phone with the Show arrow buttons setting", async () => {
    const services = makeServices(undefined, { showArrows: true })
    const { renderer } = await openAt(
      { book: "JHN", chapter: 3, verse: 16 },
      { services },
    )
    expect(arrows(renderer)).toHaveLength(1)
  })

  it("covers AE6: always shown on an iPad-sized screen", async () => {
    act(() => {
      Dimensions.set({ window: TABLET, screen: TABLET })
    })
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    expect(arrows(renderer)).toHaveLength(1)
  })

  it("moves by verse across a chapter end, with labels and 44 x 44 targets", async () => {
    const services = makeServices(undefined, { showArrows: true })
    const { renderer } = await openAt(
      { book: "JHN", chapter: 3, verse: 36 },
      { services },
    )
    const labels = [
      READER_COPY.movement.previousVerse,
      READER_COPY.movement.nextVerse,
    ]
    for (const label of labels) {
      const [target] = hosts(
        renderer,
        (node) =>
          node.props.accessibilityRole === "button" &&
          node.props.accessibilityLabel === label,
      )
      expect(target).toBeDefined()
      const style = flat(target!)
      expect(Number(style.minWidth ?? style.width)).toBeGreaterThanOrEqual(
        READER_TOUCH_TARGET,
      )
      expect(Number(style.minHeight ?? style.height)).toBeGreaterThanOrEqual(
        READER_TOUCH_TARGET,
      )
    }
    const press = async (label: string) => {
      const [control] = renderer.root.findAll(
        (node) =>
          typeof node.props.onPress === "function" &&
          node.props.accessibilityLabel === label,
      )
      await act(async () => control!.props.onPress?.())
      await flush()
      await settleFit(renderer)
    }
    await press(READER_COPY.movement.nextVerse)
    expect(pillPassage(renderer)).toBe("John 4:1")
    await press(READER_COPY.movement.previousVerse)
    expect(pillPassage(renderer)).toBe("John 3:36")
  })

  it("keeps the verse box clear of the arrow pair", async () => {
    const plain = await openAt(
      { book: "JHN", chapter: 3, verse: 16 },
      {
        onboarding: onboardingStore(SETTLED),
      },
    )
    const withArrows = await openAt(
      { book: "JHN", chapter: 3, verse: 16 },
      {
        services: makeServices(undefined, { showArrows: true }),
        onboarding: onboardingStore(SETTLED),
      },
    )
    const heightOf = (renderer: TestInstance) =>
      Number(flat(byTestId(renderer, "bible-verse-area")[0]!).height)
    expect(heightOf(withArrows.renderer)).toBeLessThan(heightOf(plain.renderer))
  })
})

// ── The pill ────────────────────────────────────────────────────────────────

describe("the pill animation (R39, AE10)", () => {
  const pill = (renderer: TestInstance) =>
    byTestId(renderer, "bible-chapter-pill")

  it("plays no animation when the reader opens", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    expect(pill(renderer)).toHaveLength(1)
    expect(timingsWith({ duration: CHAPTER_PULSE_MS })).toHaveLength(0)
    expect(timingsWith({ delay: CHAPTER_FLASH_MS })).toHaveLength(0)
  })

  it("scales the pill on the native driver for a chapter change, not a verse change", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await swipeUp(renderer)
    expect(timingsWith({ duration: CHAPTER_PULSE_MS })).toHaveLength(0)
    await swipeLeft(renderer)
    expect(
      timingsWith({ duration: CHAPTER_PULSE_MS, useNativeDriver: true }),
    ).toHaveLength(1)
    const transform = flat(pill(renderer)[0]!).transform
    expect(JSON.stringify(transform)).toContain("scale")
  })

  it("covers AE10: with Reduce Motion the pill changes color only", async () => {
    reduceMotion = true
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await swipeLeft(renderer)
    expect(pillPassage(renderer)).toBe("John 4:1")
    expect(timingsWith({ duration: CHAPTER_PULSE_MS })).toHaveLength(0)
    expect(
      timingsWith({ delay: CHAPTER_FLASH_MS, useNativeDriver: true }),
    ).toHaveLength(1)
    expect(flat(pill(renderer)[0]!).transform).toBeUndefined()
    expect(byTestId(renderer, "bible-chapter-pill-highlight")).toHaveLength(1)
  })
})

// ── The hint ────────────────────────────────────────────────────────────────

describe("the swipe hint (R15, AE10, KD18)", () => {
  const hint = (renderer: TestInstance) =>
    byTestId(renderer, "bible-swipe-hint")

  it("fades in and bounces on the native driver", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    expect(hint(renderer)).toHaveLength(1)
    expect(textNodes(renderer, READER_COPY.movement.hint)).toHaveLength(1)
    expect(
      timingsWith({ duration: SWIPE_HINT_MS, useNativeDriver: true }),
    ).toHaveLength(1)
    expect(JSON.stringify(flat(hint(renderer)[0]!).transform)).toContain(
      "translateY",
    )
  })

  it("covers AE10: with Reduce Motion the hint fades with no bounce", async () => {
    reduceMotion = true
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    expect(hint(renderer)).toHaveLength(1)
    expect(timingsWith({ duration: SWIPE_HINT_MS })).toHaveLength(1)
    expect(flat(hint(renderer)[0]!).transform).toBeUndefined()
  })

  it("leaves the accessibility tree once it has faded", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    expect(hint(renderer)[0]!.props.accessibilityElementsHidden).toBe(false)
    await finishTimings({ duration: SWIPE_HINT_MS })
    const [faded] = hint(renderer)
    expect(faded!.props.accessibilityElementsHidden).toBe(true)
    expect(faded!.props.importantForAccessibility).toBe("no-hide-descendants")
  })

  it("does not render after a verse move, and stays retired after a restart", async () => {
    const storage = memoryStorage({
      [READER_ONBOARDING_STORAGE_KEY]: serializeReaderOnboarding(AFTER_DEMO),
    })
    const { renderer } = await openAt(
      { book: "JHN", chapter: 3, verse: 16 },
      { onboarding: onboardingStore(AFTER_DEMO, storage) },
    )
    expect(hint(renderer)).toHaveLength(1)
    await swipeUp(renderer)
    expect(hint(renderer)).toHaveLength(0)

    const again = await openAt(
      { book: "JHN", chapter: 3, verse: 16 },
      { onboarding: onboardingStore(AFTER_DEMO, storage) },
    )
    expect(hint(again.renderer)).toHaveLength(0)
  })

  it("stays through a chapter move, which is not a verse move", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await swipeLeft(renderer)
    expect(hint(renderer)).toHaveLength(1)
  })
})

// ── The demo ────────────────────────────────────────────────────────────────

describe("the first-run swipe demo (R16)", () => {
  const demo = (renderer: TestInstance) =>
    byTestId(renderer, "bible-swipe-demo")

  async function arm() {
    await act(async () => {
      jest.advanceTimersByTime(SWIPE_DEMO_DELAY_MS)
    })
  }

  it("plays once per install, before the hint, and never moves the position", async () => {
    jest.useFakeTimers()
    const storage = memoryStorage()
    const services = makeServices()
    const moveTo = jest.spyOn(services.positionStore, "moveTo")
    services.positionStore.moveTo({ book: "JHN", chapter: 3, verse: 16 })
    moveTo.mockClear()
    const renderer = await render(services, {
      onboarding: onboardingStore(AFTER_DEMO, storage),
    })
    // A fresh install: nothing saved yet.
    storage.items.clear()
    await act(async () => renderer.unmount())

    const first = await render(services, {
      onboarding: createReaderOnboardingStore(storage),
    })
    await arm()
    expect(demo(first)).toHaveLength(1)
    expect(timingsWith({ duration: SWIPE_DEMO_MS })).toHaveLength(1)
    // The hint waits for the demo.
    expect(timingsWith({ duration: SWIPE_HINT_MS })).toHaveLength(0)

    await finishTimings({ duration: SWIPE_DEMO_MS })
    await flush()
    expect(demo(first)).toHaveLength(0)
    expect(timingsWith({ duration: SWIPE_HINT_MS })).toHaveLength(1)
    expect(moveTo).not.toHaveBeenCalled()
    expect(services.positionStore.getSnapshot().ref).toEqual({
      book: "JHN",
      chapter: 3,
      verse: 16,
    })

    const second = await render(services, {
      onboarding: createReaderOnboardingStore(storage),
    })
    await arm()
    expect(demo(second)).toHaveLength(0)
  })

  it("skips on a tap", async () => {
    jest.useFakeTimers()
    const store = createReaderOnboardingStore(memoryStorage())
    const { services, renderer } = await openAt(
      { book: "JHN", chapter: 3, verse: 16 },
      { onboarding: store },
    )
    const moveTo = jest.spyOn(services.positionStore, "moveTo")
    await arm()
    const [skip] = renderer.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.props.accessibilityLabel === READER_COPY.movement.demoSkipLabel,
    )
    expect(skip).toBeDefined()
    await act(async () => skip!.props.onPress?.())
    await flush()
    expect(demo(renderer)).toHaveLength(0)
    expect(store.getSnapshot().demoPlayed).toBe(true)
    expect(moveTo).not.toHaveBeenCalled()
  })

  it("is skipped with a screen reader on", async () => {
    jest.useFakeTimers()
    screenReader = true
    const store = createReaderOnboardingStore(memoryStorage())
    const { renderer } = await openAt(
      { book: "JHN", chapter: 3, verse: 16 },
      { onboarding: store },
    )
    await arm()
    expect(demo(renderer)).toHaveLength(0)
    expect(timingsWith({ duration: SWIPE_DEMO_MS })).toHaveLength(0)
  })

  it("is skipped with Reduce Motion on", async () => {
    jest.useFakeTimers()
    reduceMotion = true
    const store = createReaderOnboardingStore(memoryStorage())
    const { renderer } = await openAt(
      { book: "JHN", chapter: 3, verse: 16 },
      { onboarding: store },
    )
    await arm()
    expect(demo(renderer)).toHaveLength(0)
  })
})

// ── The verse scrubber (U9) ─────────────────────────────────────────────────

/** The footer column on the phone: 24-point sides, 392 points wide. */
const COLUMN = { left: 24, width: PHONE.width - 48 }

/** The renderer has no layout: report the scrubber band's width by hand. */
async function layoutScrubber(renderer: TestInstance) {
  const [band] = byTestId(renderer, "bible-verse-scrubber")
  expect(band).toBeDefined()
  await act(async () => {
    ;(band!.props.onLayout as (event: unknown) => void)({
      nativeEvent: { layout: { x: 0, y: 0, width: COLUMN.width, height: 44 } },
    })
  })
}

type ScrubHandlers = {
  onStartShouldSetResponder: (e: GestureResponderEvent) => boolean
  onResponderGrant: (e: GestureResponderEvent) => void
  onResponderMove: (e: GestureResponderEvent) => void
  onResponderRelease: (e: GestureResponderEvent) => void
}

function thumbHandlers(renderer: TestInstance): ScrubHandlers {
  const [thumb] = byTestId(renderer, "bible-scrubber-thumb")
  expect(thumb).toBeDefined()
  return thumb!.props as unknown as ScrubHandlers
}

/** The thumb's center, in window coordinates. */
function thumbCenter(renderer: TestInstance): Point {
  const [thumb] = byTestId(renderer, "bible-scrubber-thumb")
  const style = flat(thumb!)
  return {
    x: COLUMN.left + Number(style.left) + Number(style.width) / 2,
    y: PHONE.height - mockInsets.bottom - 90,
  }
}

/** Presses the thumb and drags it through each fraction of the bar. */
async function scrub(renderer: TestInstance, fractions: number[]) {
  await layoutScrubber(renderer)
  const start = thumbCenter(renderer)
  expect(
    thumbHandlers(renderer).onStartShouldSetResponder(
      touch(start, start, true),
    ),
  ).toBe(true)
  await act(async () =>
    thumbHandlers(renderer).onResponderGrant(touch(start, start, true)),
  )
  let at = start
  for (const fraction of fractions) {
    const next = { x: COLUMN.left + fraction * COLUMN.width, y: start.y }
    const from = at
    at = next
    await act(async () =>
      thumbHandlers(renderer).onResponderMove(touch(next, from)),
    )
    await flush()
    await settleFit(renderer)
  }
  return {
    release: async () => {
      await act(async () =>
        thumbHandlers(renderer).onResponderRelease(touch(at, at)),
      )
      await flush()
      await settleFit(renderer)
    },
  }
}

describe("the verse scrubber (R18, KD7)", () => {
  it("shows each verse during a drag and saves the position once, at release", async () => {
    const { services, renderer } = await openAt({
      book: "JHN",
      chapter: 3,
      verse: 1,
    })
    const moveTo = jest.spyOn(services.positionStore, "moveTo")
    const drag = await scrub(renderer, [0.25, 0.4, 0.5])
    // Still's design: the verse, the pill, and the counter follow the thumb.
    expect(pillPassage(renderer)).toBe("John 3:18")
    expect(textNodes(renderer, "18 / 36")).toHaveLength(1)
    expect(textNodes(renderer, "Whoever believes in Him")).not.toHaveLength(0)
    expect(moveTo).not.toHaveBeenCalled()

    await drag.release()
    expect(pillPassage(renderer)).toBe("John 3:18")
    expect(moveTo).toHaveBeenCalledTimes(1)
    expect(moveTo).toHaveBeenCalledWith({ book: "JHN", chapter: 3, verse: 18 })
    // A scrub is not a chapter change: no pill animation.
    expect(timingsWith({ duration: CHAPTER_PULSE_MS })).toHaveLength(0)
  })

  it("saves nothing for a drag that ends on the verse it started from", async () => {
    const { services, renderer } = await openAt({
      book: "JHN",
      chapter: 3,
      verse: 18,
    })
    const moveTo = jest.spyOn(services.positionStore, "moveTo")
    const drag = await scrub(renderer, [0.8, 0.5])
    await drag.release()
    expect(pillPassage(renderer)).toBe("John 3:18")
    expect(moveTo).not.toHaveBeenCalled()
  })

  it("keys by verse number and lands on a merged stop's first verse (KTD19)", async () => {
    const services = makeServices(async () => ({
      status: "ok",
      text: fixtureText(t4tJohn4),
    }))
    services.positionStore.pickTranslation("eng_t4t")
    const { renderer } = await openAt(
      { book: "JHN", chapter: 4, verse: 1 },
      { services },
    )
    const moveTo = jest.spyOn(services.positionStore, "moveTo")
    // 7 / 54 of the bar is inside T4T's merged John 4:6-8.
    const drag = await scrub(renderer, [7 / 54])
    expect(pillPassage(renderer)).toBe("John 4:6-8")
    expect(textNodes(renderer, "6-8 / 54")).toHaveLength(1)
    await drag.release()
    expect(moveTo).toHaveBeenCalledTimes(1)
    expect(moveTo).toHaveBeenLastCalledWith({
      book: "JHN",
      chapter: 4,
      verse: 6,
    })
  })

  it("leaves the left strip to the back swipe on the pushed reader only (R6)", async () => {
    const inStrip = { x: BACK_SWIPE_EDGE_WIDTH - 4, y: MIDDLE.y }
    const pushed = await openAt(
      { book: "JHN", chapter: 3, verse: 1 },
      { extra: { host: "pushed", onBack: jest.fn() } },
    )
    await layoutScrubber(pushed.renderer)
    expect(
      thumbHandlers(pushed.renderer).onStartShouldSetResponder(
        touch(inStrip, inStrip, true),
      ),
    ).toBe(false)
    const tab = await openAt({ book: "JHN", chapter: 3, verse: 1 })
    await layoutScrubber(tab.renderer)
    expect(
      thumbHandlers(tab.renderer).onStartShouldSetResponder(
        touch(inStrip, inStrip, true),
      ),
    ).toBe(true)
  })
})

// ── Verse selection, Copy, and Share (U9) ──────────────────────────────────

const setClipboard = Clipboard.setStringAsync as jest.Mock

/** The verse's Pressable holds `onPress`; its host View does not. */
async function tapVerse(renderer: TestInstance) {
  const [verse] = renderer.root.findAll(
    (node) =>
      node.props.testID === "bible-verse" &&
      typeof node.props.onPress === "function",
  )
  expect(verse).toBeDefined()
  await act(async () => verse!.props.onPress?.())
  await flush()
  await settleFit(renderer)
}

/** The selection bar's reference, or null when the footer shows. */
function selected(renderer: TestInstance): string | null {
  const prefix = READER_COPY.selection.selected("")
  const [reference] = hosts(
    renderer,
    (node) =>
      node.type === "Text" &&
      String(node.props.accessibilityLabel ?? "").startsWith(prefix),
  )
  return reference ? textOf(reference) : null
}

function verseState(renderer: TestInstance) {
  const [verse] = byTestId(renderer, "bible-verse")
  expect(verse).toBeDefined()
  return verse!.props.accessibilityState as { selected?: boolean } | undefined
}

async function pressLabel(renderer: TestInstance, label: string) {
  const [control] = renderer.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.props.accessibilityLabel === label,
  )
  expect(control).toBeDefined()
  await act(async () => control!.props.onPress?.())
  await flush()
}

describe("verse selection (R19)", () => {
  beforeEach(() => {
    setClipboard.mockClear()
  })

  it("selects the verse on a tap, and the bar takes the footer's place", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    expect(selected(renderer)).toBeNull()
    expect(byTestId(renderer, "bible-reader-footer")).toHaveLength(1)
    expect(verseState(renderer)).toEqual({ selected: false })

    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 3:16")
    expect(byTestId(renderer, "bible-reader-footer")).toHaveLength(0)
    expect(byTestId(renderer, "bible-verse-scrubber")).toHaveLength(0)
    expect(verseState(renderer)).toEqual({ selected: true })
    // Still's design: a selected verse is underlined.
    const [line] = byTestId(renderer, "bible-verse-line")
    const style = StyleSheet.flatten(line!.props.style as StyleProp<TextStyle>)
    expect(style.textDecorationLine).toBe("underline")
  })

  it("keeps the selection through swipes in the chapter; the next verse adds on", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await tapVerse(renderer)
    await swipeUp(renderer)
    expect(pillPassage(renderer)).toBe("John 3:17")
    expect(selected(renderer)).toBe("John 3:16")
    expect(verseState(renderer)).toEqual({ selected: false })

    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 3:16-17")
    await swipeDown(renderer)
    await swipeDown(renderer)
    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 3:15-17")
  })

  it("starts a new selection at 3:18 after 3:16", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await tapVerse(renderer)
    await swipeUp(renderer)
    await swipeUp(renderer)
    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 3:18")
  })

  it("cuts 3:16-18 to 3:16 when 3:17 is tapped again", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await tapVerse(renderer)
    await swipeUp(renderer)
    await tapVerse(renderer)
    await swipeUp(renderer)
    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 3:16-18")
    await swipeDown(renderer)
    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 3:16")
  })

  it("covers R14: a swipe up from a selected John 3:36 opens John 4:1 and clears it", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 36 })
    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 3:36")
    await swipeUp(renderer)
    expect(pillPassage(renderer)).toBe("John 4:1")
    expect(selected(renderer)).toBeNull()
    expect(byTestId(renderer, "bible-reader-footer")).toHaveLength(1)
    // Cleared, not hidden: the way back finds no selection.
    await swipeDown(renderer)
    expect(pillPassage(renderer)).toBe("John 3:36")
    expect(selected(renderer)).toBeNull()
  })

  it("clears on a chapter swipe", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await tapVerse(renderer)
    await swipeLeft(renderer)
    expect(pillPassage(renderer)).toBe("John 4:1")
    expect(selected(renderer)).toBeNull()
  })

  it("clears on a translation change", async () => {
    const services = makeServices(async () => ({
      status: "ok",
      text: fixtureText(t4tJohn4),
    }))
    const { renderer } = await openAt(
      { book: "JHN", chapter: 4, verse: 9 },
      { services },
    )
    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 4:9")
    await act(async () => {
      services.positionStore.pickTranslation("eng_t4t")
    })
    await flush()
    await settleFit(renderer)
    expect(selected(renderer)).toBeNull()
    // Cleared, not hidden: back in BSB, the selection stays gone.
    await act(async () => {
      services.positionStore.pickTranslation(null)
    })
    await flush()
    await settleFit(renderer)
    expect(selected(renderer)).toBeNull()
  })

  it("selects T4T John 4:6-8 as one stop", async () => {
    const services = makeServices(async () => ({
      status: "ok",
      text: fixtureText(t4tJohn4),
    }))
    services.positionStore.pickTranslation("eng_t4t")
    const { renderer } = await openAt(
      { book: "JHN", chapter: 4, verse: 6 },
      { services },
    )
    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 4:6-8")
  })

  it("never selects the Matthew 18:11 note, and a run passes over it", async () => {
    const { renderer } = await openAt({ book: "MAT", chapter: 18, verse: 10 })
    await tapVerse(renderer)
    await swipeUp(renderer)
    const notes = renderer.root.findAll(
      (node) => node.props.testID === "bible-missing-verse",
    )
    expect(notes.length).toBeGreaterThan(0)
    for (const note of notes) expect(note.props.onPress).toBeUndefined()
    expect(selected(renderer)).toBe("Matthew 18:10")
    await swipeUp(renderer)
    await tapVerse(renderer)
    expect(selected(renderer)).toBe("Matthew 18:10-12")
  })

  it("clears with Android back, which then does not pop", async () => {
    const backHandlers: (() => boolean)[] = []
    jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((_, handler) => {
        const fn = handler as unknown as () => boolean
        backHandlers.push(fn)
        return {
          remove: () => {
            const at = backHandlers.indexOf(fn)
            if (at !== -1) backHandlers.splice(at, 1)
          },
        }
      })
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    // No selection: back belongs to the navigator.
    expect(backHandlers).toHaveLength(0)
    await tapVerse(renderer)
    expect(backHandlers).toHaveLength(1)
    let consumed = false
    await act(async () => {
      consumed = backHandlers[0]!()
    })
    expect(consumed).toBe(true)
    expect(selected(renderer)).toBeNull()
    expect(backHandlers).toHaveLength(0)
  })

  it("clears with the Clear button, and the footer and scrubber come back", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await tapVerse(renderer)
    await pressLabel(renderer, READER_COPY.selection.clearLabel)
    expect(selected(renderer)).toBeNull()
    expect(byTestId(renderer, "bible-reader-footer")).toHaveLength(1)
    // A scrub works again, and the next tap starts a new selection there.
    const drag = await scrub(renderer, [0.5])
    await drag.release()
    await tapVerse(renderer)
    expect(selected(renderer)).toBe("John 3:18")
  })

  it("copies and shares the verses, then John 3:16-17 · BSB", async () => {
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: Share.sharedAction })
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    await tapVerse(renderer)
    await swipeUp(renderer)
    await tapVerse(renderer)
    await pressLabel(renderer, READER_COPY.selection.copyLabel("John 3:16-17"))
    await pressLabel(renderer, READER_COPY.selection.shareLabel("John 3:16-17"))
    const text =
      "16 For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life. " +
      "17 For God did not send His Son into the world to condemn the world, but to save the world through Him." +
      "\n\nJohn 3:16-17 · BSB"
    expect(setClipboard).toHaveBeenCalledTimes(1)
    expect(setClipboard).toHaveBeenCalledWith(text)
    expect(share).toHaveBeenCalledTimes(1)
    expect(share.mock.calls[0]?.[0]).toMatchObject({ message: text })
  })

  it("covers AE17: a Synodal selection shares Synodal numbers (R42)", async () => {
    const psalm = fixtureText(synodalPsalm50)
    const services = makeServices(async () => ({ status: "ok", text: psalm }))
    services.positionStore.pickTranslation("rus_syn")
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: Share.sharedAction })
    const { renderer } = await openAt(
      { book: "PSA", chapter: 51, verse: 1 },
      { services },
    )
    // BSB Psalm 51:1 opens Synodal Psalm 50:3; step back to the title.
    await swipeDown(renderer)
    await swipeDown(renderer)
    expect(pillPassage(renderer)).toBe(`${psalm.bookName} 50:1`)
    await tapVerse(renderer)
    await swipeUp(renderer)
    await tapVerse(renderer)
    const reference = `${psalm.bookName} 50:1-2`
    expect(selected(renderer)).toBe(reference)
    await pressLabel(renderer, READER_COPY.selection.shareLabel(reference))
    const message = String(
      (share.mock.calls[0]?.[0] as { message?: string }).message,
    )
    expect(message.endsWith(`\n\n${reference} · SYN`)).toBe(true)
    expect(message.startsWith("1 Начальнику хора.")).toBe(true)
    expect(message).not.toContain("51")
  })

  it("tells a screen reader how to select, and that the verse is selected", async () => {
    const { renderer } = await openAt({ book: "JHN", chapter: 3, verse: 16 })
    const [verse] = byTestId(renderer, "bible-verse")
    expect(verse!.props.accessibilityHint).toBe(
      READER_COPY.selection.selectHint,
    )
    await tapVerse(renderer)
    const [after] = byTestId(renderer, "bible-verse")
    expect(after!.props.accessibilityHint).toBe(
      READER_COPY.selection.removeHint,
    )
    expect(after!.props.accessibilityRole).toBe("adjustable")
  })
})

// ── The passage picker's jump (R39) ─────────────────────────────────────────

describe("a passage-picker jump pulses the pill (R39)", () => {
  type Opened = {
    services: ReaderServices
    renderer: TestInstance
    onOpenPassagePicker: jest.Mock
    /** The picker is a root sheet: it takes the reader's focus while up. */
    setFocus: (focused: boolean) => Promise<void>
  }

  async function openWithFocus(ref: VerseRef): Promise<Opened> {
    const services = makeServices()
    services.positionStore.moveTo(ref)
    const onOpenPassagePicker = jest.fn()
    const props = {
      host: "tab",
      onOpenPassagePicker,
      onOpenTranslationPicker: jest.fn(),
      onOpenSettings: jest.fn(),
      onOpenDownload: jest.fn(),
      services,
      onboardingStore: onboardingStore(SETTLED),
    } as BibleReaderProps
    const element = () => (
      <StrictMode>
        <BibleReader {...props} />
      </StrictMode>
    )
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(element())
    })
    mounted.push(renderer)
    await flush()
    await settleFit(renderer)
    const setFocus = async (focused: boolean) => {
      mockFocus.focused = focused
      await act(async () => renderer.update(element()))
      await flush()
      await settleFit(renderer)
    }
    return { services, renderer, onOpenPassagePicker, setFocus }
  }

  const pulses = () => timingsWith({ duration: CHAPTER_PULSE_MS }).length

  async function openPicker(opened: Opened, passage: string) {
    await pressLabel(opened.renderer, READER_COPY.choosePassage(passage))
    expect(opened.onOpenPassagePicker).toHaveBeenCalledTimes(1)
    await opened.setFocus(false)
  }

  /** What `app/reader-passage.tsx` does: save the pick, then close. */
  async function pickAndClose(opened: Opened, ref: VerseRef) {
    await act(async () => {
      opened.services.positionStore.moveTo(ref)
    })
    await flush()
    await settleFit(opened.renderer)
    await opened.setFocus(true)
  }

  it("pulses once when the pick opens another chapter, after the sheet closes", async () => {
    const opened = await openWithFocus({ book: "JHN", chapter: 3, verse: 16 })
    expect(pulses()).toBe(0)
    await openPicker(opened, "John 3:16")

    await act(async () => {
      opened.services.positionStore.moveTo({
        book: "JHN",
        chapter: 5,
        verse: 1,
      })
    })
    await flush()
    // The sheet still covers the reader.
    expect(pulses()).toBe(0)

    await opened.setFocus(true)
    expect(pillPassage(opened.renderer)).toBe("John 5:1")
    expect(pulses()).toBe(1)
    // Once: a later render with nothing new plays nothing more, and the next
    // swipe pulses for itself alone.
    await opened.setFocus(true)
    expect(pulses()).toBe(1)
    await swipeLeft(opened.renderer)
    expect(pillPassage(opened.renderer)).toBe("John 6:1")
    expect(pulses()).toBe(2)
  })

  it("keeps Reduce Motion's color-only change for a picker jump (AE10)", async () => {
    reduceMotion = true
    const opened = await openWithFocus({ book: "JHN", chapter: 3, verse: 16 })
    await openPicker(opened, "John 3:16")
    await pickAndClose(opened, { book: "JHN", chapter: 5, verse: 1 })
    expect(pulses()).toBe(0)
    expect(timingsWith({ delay: CHAPTER_FLASH_MS })).toHaveLength(1)
  })

  it("plays nothing for a pick in the same chapter", async () => {
    const opened = await openWithFocus({ book: "JHN", chapter: 3, verse: 16 })
    await openPicker(opened, "John 3:16")
    await pickAndClose(opened, { book: "JHN", chapter: 3, verse: 20 })
    expect(pillPassage(opened.renderer)).toBe("John 3:20")
    expect(pulses()).toBe(0)
  })

  it("pulses once for a pick in another book, when that book shows", async () => {
    const opened = await openWithFocus({ book: "JHN", chapter: 3, verse: 16 })
    await openPicker(opened, "John 3:16")
    await pickAndClose(opened, { book: "ROM", chapter: 8, verse: 28 })
    expect(pillPassage(opened.renderer)).toBe("Romans 8:28")
    expect(pulses()).toBe(1)
  })

  it("plays nothing when the picker closes with no pick, and a later swipe pulses once", async () => {
    const opened = await openWithFocus({ book: "JHN", chapter: 3, verse: 16 })
    await openPicker(opened, "John 3:16")
    await opened.setFocus(true)
    expect(pulses()).toBe(0)

    await swipeLeft(opened.renderer)
    expect(pillPassage(opened.renderer)).toBe("John 4:1")
    expect(pulses()).toBe(1)
  })

  it("plays nothing when a covered reader regains focus at a new chapter", async () => {
    // The Bible tab under a pushed reader: another host moved the position.
    const opened = await openWithFocus({ book: "JHN", chapter: 3, verse: 16 })
    await opened.setFocus(false)
    await act(async () => {
      opened.services.positionStore.moveTo({
        book: "JHN",
        chapter: 5,
        verse: 1,
      })
    })
    await flush()
    await opened.setFocus(true)
    expect(pillPassage(opened.renderer)).toBe("John 5:1")
    expect(pulses()).toBe(0)
  })
})
