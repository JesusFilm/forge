// The Downloads screen is a root route: no tab bar sits under the list, so no
// selection path may touch the tab-bar store (KTD3). The `react` re-points
// follow src/components/profile/__tests__/MyWatchHeader.test.tsx.

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

// The `mock` prefix is required: babel-plugin-jest-hoist lifts every jest.mock
// above these declarations. Each factory reads them at RENDER time.
const mockBlurListeners: Array<() => void> = []
const mockNavigation = {
  setOptions: jest.fn(),
  addListener: jest.fn((event: string, listener: () => void) => {
    if (event === "blur") mockBlurListeners.push(listener)
    return () => {
      const index = mockBlurListeners.indexOf(listener)
      if (index >= 0) mockBlurListeners.splice(index, 1)
    }
  }),
}
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  canGoBack: () => true,
}
const mockParams: { series?: string } = {}
const mockInsets = { top: 59, right: 0, bottom: 34, left: 0 }

function mockRecord(
  videoSlug: string,
  series?: { slug: string; title: string; index: number },
) {
  return {
    version: 1,
    videoSlug,
    dubDocumentId: `dub-${videoSlug}`,
    renditionDocumentId: `rendition-${videoSlug}`,
    qualityLabel: "High",
    title: videoSlug,
    subtitleLanguageSlug: null,
    state: "downloaded" as const,
    committedPath: `/downloads/${videoSlug}.mp4`,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 1024,
    totalBytes: 1024,
    seriesSlug: series?.slug,
    seriesTitle: series?.title,
    seriesEpisodeIndex: series?.index,
  }
}
type MockRecord = ReturnType<typeof mockRecord>

const ONE_VIDEO: MockRecord[] = [mockRecord("the-birth-of-jesus")]
const TWO_SERIES: MockRecord[] = [
  mockRecord("a-1", { slug: "series-a", title: "Series A", index: 1 }),
  mockRecord("a-2", { slug: "series-a", title: "Series A", index: 2 }),
  mockRecord("b-1", { slug: "series-b", title: "Series B", index: 1 }),
  mockRecord("the-birth-of-jesus"),
]

// A test that needs another manifest state writes here; afterEach restores it.
const mockDownloads: { offlineRecords: MockRecord[]; isReady: boolean } = {
  offlineRecords: ONE_VIDEO,
  isReady: true,
}

jest.mock("../../src/lib/tabBarVisibility", () => ({
  setTabBarHidden: jest.fn(),
  resetTabBarHidden: jest.fn(),
}))
jest.mock("expo-router", () => ({
  useNavigation: () => mockNavigation,
  useIsFocused: () => true,
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
jest.mock("../../src/contexts/DownloadsProvider", () => ({
  useDownloads: () => ({
    offlineRecords: mockDownloads.offlineRecords,
    isReady: mockDownloads.isReady,
    // The real provider drops the record, which the next render reads.
    deleteDownload: (slug: string) => {
      mockDownloads.offlineRecords = mockDownloads.offlineRecords.filter(
        (record) => record.videoSlug !== slug,
      )
      return Promise.resolve()
    },
    retryDownload: () => Promise.resolve(),
    resumeDownload: () => Promise.resolve(),
  }),
}))
jest.mock("../../src/contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => ({
    longPressHintSeen: true,
    setLongPressHintSeen: () => {},
    isReady: true,
  }),
}))
jest.mock("../../src/lib/datadog", () => ({
  datadogLog: { info: () => {}, warn: () => {}, error: () => {} },
}))

// Each of these pulls a native module (expo-image, expo-blur) that this suite
// has no reason to load. Named functions, so a case can find each by type and
// read or call its props. The Select and Cancel controls live in the list.
jest.mock("../../src/components/library/DownloadRow", () => ({
  DownloadRow: function MockDownloadRow() {
    return null
  },
}))
jest.mock("../../src/components/library/SeriesGroupCard", () => ({
  SeriesGroupCard: function MockSeriesGroupCard() {
    return null
  },
}))
jest.mock("../../src/components/library/DownloadsSummary", () => ({
  DownloadsSummary: () => null,
}))
jest.mock("../../src/components/library/SelectionActionBar", () => ({
  SelectionActionBar: function MockSelectionActionBar() {
    return null
  },
}))
jest.mock("../../src/components/library/DeleteConfirmSheet", () => ({
  DeleteConfirmSheet: function MockDeleteConfirmSheet() {
    return null
  },
}))
jest.mock("../../src/components/ui/Snackbar", () => ({
  Snackbar: function MockSnackbar() {
    return null
  },
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))

import { Children, act, isValidElement, type ReactNode } from "react"
import { BackHandler, Dimensions, Platform, ScrollView } from "react-native"

import DownloadsScreen from "../downloads"
import { DeleteConfirmSheet } from "../../src/components/library/DeleteConfirmSheet"
import { LibraryEmptyState } from "../../src/components/library/LibraryEmptyState"
import { SelectionActionBar } from "../../src/components/library/SelectionActionBar"
import { SeriesGroupCard } from "../../src/components/library/SeriesGroupCard"
import { Snackbar } from "../../src/components/ui/Snackbar"
import { TAB_BAR_HEIGHT_IOS } from "../../src/lib/tabBar"
import {
  resetTabBarHidden,
  setTabBarHidden,
} from "../../src/lib/tabBarVisibility"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"

const mockedSetTabBarHidden = jest.mocked(setTabBarHidden)
const mockedResetTabBarHidden = jest.mocked(resetTabBarHidden)

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}

// An iPhone 17 window, so the floating-window term below is a real phone's.
const JEST_WINDOW = Dimensions.get("window")
const PHONE_WINDOW = { width: 402, height: 874, scale: 3, fontScale: 1 }

let scrollTo: jest.SpyInstance
beforeEach(() => {
  Dimensions.set({ window: PHONE_WINDOW, screen: PHONE_WINDOW })
  // The preset puts ONE jest.fn on the prototype and spyOn hands that same
  // mock back, so its calls carry across cases unless cleared here.
  scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo")
  scrollTo.mockClear()
})

afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  Dimensions.set({ window: JEST_WINDOW, screen: JEST_WINDOW })
  jest.restoreAllMocks()
  mockedSetTabBarHidden.mockClear()
  mockedResetTabBarHidden.mockClear()
  mockNavigation.setOptions.mockClear()
  mockNavigation.addListener.mockClear()
  mockBlurListeners.length = 0
  mockDownloads.offlineRecords = ONE_VIDEO
  mockDownloads.isReady = true
  delete mockParams.series
  Object.assign(mockInsets, { top: 59, right: 0, bottom: 34, left: 0 })
})

async function mountScreen(os: "ios" | "android"): Promise<TestInstance> {
  setPlatform(os)
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<DownloadsScreen />)
  })
  return renderer
}

async function renderScreen(os: "ios" | "android"): Promise<TestInstance> {
  const renderer = await mountScreen(os)
  // The Select pill exists only on the ready-with-records branch.
  expect(hasControl(renderer, "Select downloads")).toBe(true)
  return renderer
}

/** The head row swaps its controls on the selection flag, so the Cancel pill
 *  existing IS selection mode. */
function hasControl(renderer: TestInstance, label: string): boolean {
  return (
    renderer.root.findAll(
      (node) =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === "function",
    ).length > 0
  )
}

async function enterSelection(renderer: TestInstance) {
  await press(pressableByLabel(renderer, "Select downloads"))
  expect(hasControl(renderer, "Cancel selection")).toBe(true)
}

function nodesOfType(renderer: TestInstance, type: unknown): RenderedNode[] {
  return renderer.root.findAll((node) => node.type === type)
}

function scrollView(renderer: TestInstance): RenderedNode {
  const views = nodesOfType(renderer, ScrollView)
  expect(views.length).toBe(1)
  return views[0]!
}

/** RN's ScrollView maps stickyHeaderIndices onto Children.toArray, which
 *  drops `false` slots, so every index here does the same. */
function scrollChildren(renderer: TestInstance): ReactNode[] {
  return Children.toArray(scrollView(renderer).props.children as ReactNode)
}

function stickyIndices(renderer: TestInstance): number[] | undefined {
  return scrollView(renderer).props.stickyHeaderIndices as number[] | undefined
}

function pinnedChild(renderer: TestInstance): ReactNode {
  const indices = stickyIndices(renderer)
  expect(indices?.length).toBe(1)
  return scrollChildren(renderer)[indices![0]!]
}

/** Does this element subtree hold a control with this label? */
function elementHasLabel(node: ReactNode, label: string): boolean {
  if (!isValidElement(node)) return false
  const props = node.props as {
    accessibilityLabel?: string
    children?: ReactNode
  }
  if (props.accessibilityLabel === label) return true
  return Children.toArray(props.children).some((child) =>
    elementHasLabel(child, label),
  )
}

function flatten(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    return Object.assign({}, ...raw.map(flatten))
  }
  return raw != null && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {}
}

function contentPad(renderer: TestInstance): number {
  const style = flatten(scrollView(renderer).props.contentContainerStyle)
  return style.paddingBottom as number
}

/** Every setOptions payload that carries the Android bar lever. */
function tabBarStyleOptions(): unknown[] {
  return mockNavigation.setOptions.mock.calls
    .map(([options]) => options)
    .filter(
      (options) =>
        typeof options === "object" &&
        options !== null &&
        "tabBarStyle" in options,
    )
}

describe("the Downloads screen", () => {
  it("puts a Downloads top bar with a back control above the list", async () => {
    const renderer = await renderScreen("ios")
    const all = renderer.root.findAll(() => true)
    const heading = all.findIndex(
      (node) =>
        node.props.accessibilityRole === "header" &&
        node.props.children === "Downloads",
    )
    expect(heading).toBeGreaterThanOrEqual(0)
    expect(heading).toBeLessThan(all.indexOf(scrollView(renderer)))
    expect(hasControl(renderer, "Go back")).toBe(true)
    // The tab host's "My Downloads" title does not come along.
    expect(hasText(renderer, "My Downloads")).toBe(false)
    await unmount(renderer)
  })

  it("pins the Select row when nothing sits above it", async () => {
    const renderer = await renderScreen("ios")

    expect(stickyIndices(renderer)).toEqual([0])
    expect(elementHasLabel(pinnedChild(renderer), "Select downloads")).toBe(
      true,
    )

    await enterSelection(renderer)
    expect(elementHasLabel(pinnedChild(renderer), "Cancel selection")).toBe(
      true,
    )
    await unmount(renderer)
  })

  it("shows the empty state at its full-screen gap with no downloads", async () => {
    mockDownloads.offlineRecords = []
    const renderer = await mountScreen("ios")

    const empties = nodesOfType(renderer, LibraryEmptyState)
    // Counts, not node arrays: a node diff on failure can exhaust jest's heap.
    expect(empties.length).toBe(1)
    expect(empties[0]!.props.style).toBeUndefined()
    expect(hasText(renderer, "No Downloads Yet")).toBe(true)
    // No Select row exists, so nothing may pin.
    expect(stickyIndices(renderer)).toBeUndefined()
    expect(hasControl(renderer, "Select downloads")).toBe(false)
    await unmount(renderer)
  })

  it("shows neither the list nor the empty state until downloads load", async () => {
    // Records exist, so a missing Select control proves the isReady gate.
    mockDownloads.isReady = false
    const renderer = await mountScreen("ios")

    expect(hasControl(renderer, "Select downloads")).toBe(false)
    expect(nodesOfType(renderer, LibraryEmptyState).length).toBe(0)
    expect(stickyIndices(renderer)).toBeUndefined()
    await unmount(renderer)
  })
})

describe("selection on a root route", () => {
  it.each(["ios", "android"] as const)(
    "shows the action bar and never calls the tab-bar store (%s)",
    async (os) => {
      const renderer = await renderScreen(os)
      await enterSelection(renderer)
      expect(nodesOfType(renderer, SelectionActionBar).length).toBe(1)

      await press(pressableByLabel(renderer, "Cancel selection"))
      expect(nodesOfType(renderer, SelectionActionBar).length).toBe(0)
      await enterSelection(renderer)
      await act(async () => {
        mockBlurListeners.forEach((listener) => listener())
      })
      await unmount(renderer)

      // The pre-U4 list made each of these calls on this same path.
      expect(mockedSetTabBarHidden).not.toHaveBeenCalled()
      expect(mockedResetTabBarHidden).not.toHaveBeenCalled()
      expect(tabBarStyleOptions().length).toBe(0)
    },
  )

  it("exits selection on blur, so a screen pushed on top never inherits it", async () => {
    const renderer = await renderScreen("android")
    await enterSelection(renderer)
    // Anti-vacuous: an empty registry would make the forEach below a no-op.
    expect(mockBlurListeners).toHaveLength(1)

    await act(async () => {
      mockBlurListeners.forEach((listener) => listener())
    })

    expect(hasControl(renderer, "Cancel selection")).toBe(false)
    await unmount(renderer)
  })

  it("takes Android back to exit selection before the screen closes", async () => {
    const handlers: Array<() => boolean> = []
    jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((_, handler) => {
        const fn = handler as unknown as () => boolean
        handlers.push(fn)
        return {
          remove: () => {
            const at = handlers.indexOf(fn)
            if (at !== -1) handlers.splice(at, 1)
          },
        }
      })
    const renderer = await renderScreen("android")
    expect(handlers.length).toBe(0)
    await enterSelection(renderer)
    expect(handlers.length).toBe(1)

    let consumed = false
    await act(async () => {
      consumed = handlers[0]!()
    })

    expect(consumed).toBe(true)
    expect(hasControl(renderer, "Cancel selection")).toBe(false)
    // Gone with selection, so the next back press reaches the stack and pops.
    expect(handlers.length).toBe(0)
    await unmount(renderer)
  })
})

describe("deleting on the Downloads screen", () => {
  it("shows the empty state and the toast after every record goes", async () => {
    const renderer = await renderScreen("ios")
    await enterSelection(renderer)
    await press(pressableByLabel(renderer, "Select all"))

    const bar = nodesOfType(renderer, SelectionActionBar)[0]!
    const onDeletePress = bar.props.onDeletePress as () => void
    await act(async () => {
      onDeletePress()
    })
    const sheet = nodesOfType(renderer, DeleteConfirmSheet)[0]!
    expect(sheet.props.visible).toBe(true)
    await act(async () => {
      await (sheet.props.onConfirm as () => Promise<void>)()
    })

    expect(nodesOfType(renderer, LibraryEmptyState).length).toBe(1)
    expect(hasText(renderer, "No Downloads Yet")).toBe(true)
    expect(nodesOfType(renderer, SelectionActionBar).length).toBe(0)
    const toast = nodesOfType(renderer, Snackbar)[0]!
    expect(toast.props.visible).toBe(true)
    expect(toast.props.message).toMatch(/^1 video deleted · /)
    // No tab bar under a root route, so the toast lifts off the inset only.
    expect(toast.props.clearsTabBar).toBeFalsy()
    await unmount(renderer)
  })
})

describe("the list's bottom pad on a root route", () => {
  // The floating window rests on PlaybackHost's fixed reserve (49 iOS, 56
  // Android) plus a 12pt margin; a 402pt window makes it 169x95. Hand-derived.
  const IOS_WINDOW_BAND = 49 + 12 + 95
  const ANDROID_WINDOW_BAND = 56 + 12 + 95
  const LIST_END_GAP = 24

  it("clears the home indicator and the floating window on iOS", async () => {
    const renderer = await renderScreen("ios")
    expect(contentPad(renderer)).toBe(34 + IOS_WINDOW_BAND + LIST_END_GAP)
    await unmount(renderer)
  })

  it("adds no second bar height when selection shows the action bar", async () => {
    // At a root inset of 34 the action bar is 49 + 34 tall. It stands inside
    // the window's reserve, so selection must not add another 49 on top.
    const renderer = await renderScreen("ios")
    const idle = contentPad(renderer)
    await enterSelection(renderer)
    expect(contentPad(renderer)).toBe(idle)
    expect(contentPad(renderer)).toBeGreaterThan(34 + TAB_BAR_HEIGHT_IOS)
    await unmount(renderer)
  })

  it("includes the inset on Android too, where the tab clearance was 0", async () => {
    mockInsets.bottom = 48
    const renderer = await renderScreen("android")
    expect(contentPad(renderer)).toBe(48 + ANDROID_WINDOW_BAND + LIST_END_GAP)

    // Android's action bar is 14 + 1 + 48 + 14 over the inset, still inside.
    await enterSelection(renderer)
    expect(contentPad(renderer)).toBe(48 + ANDROID_WINDOW_BAND + LIST_END_GAP)
    expect(contentPad(renderer)).toBeGreaterThan(48 + 77)
    await unmount(renderer)
  })

  it("leaves every pad to the list, so no container pads twice", async () => {
    const renderer = await renderScreen("ios")
    let node = scrollView(renderer).parent
    let ancestors = 0
    while (node != null) {
      const style = flatten(node.props.style)
      expect(style.paddingBottom).toBeUndefined()
      expect(style.paddingTop).toBeUndefined()
      ancestors += 1
      node = node.parent
    }
    // Anti-vacuous: the host View and the list's own root View at least.
    expect(ancestors).toBeGreaterThanOrEqual(2)
    await unmount(renderer)
  })
})

describe("opening at a series (AE3)", () => {
  function layoutEvent(y: number, height = 60) {
    return { nativeEvent: { layout: { x: 0, y, width: 402, height } } }
  }

  function card(renderer: TestInstance, slug: string): RenderedNode {
    const matches = nodesOfType(renderer, SeriesGroupCard).filter(
      (node) =>
        (node.props.group as { seriesSlug: string }).seriesSlug === slug,
    )
    expect(matches.length).toBe(1)
    return matches[0]!
  }

  /** Fires the card, head and list layouts in that order: native layout
   *  events carry no order, so no scroll may start before the last one. */
  async function layOut(renderer: TestInstance) {
    const before = scrollTo.mock.calls.length
    const reportCard = card(renderer, "series-a").props.onCardLayout as (
      slug: string,
      y: number,
    ) => void
    const [head, list] = scrollChildren(renderer) as Array<{
      props: { onLayout: (event: unknown) => void }
    }>
    await act(async () => {
      reportCard("series-a", 40)
      reportCard("series-b", 300)
    })
    await act(async () => {
      head!.props.onLayout(layoutEvent(0, 90))
    })
    expect(scrollTo).toHaveBeenCalledTimes(before)
    await act(async () => {
      list!.props.onLayout(layoutEvent(120, 900))
    })
  }

  it("expands the named series and scrolls to it once, without animation", async () => {
    mockDownloads.offlineRecords = TWO_SERIES
    mockParams.series = "series-b"
    const renderer = await renderScreen("ios")

    expect(card(renderer, "series-b").props.initiallyExpanded).toBe(true)
    expect(card(renderer, "series-a").props.initiallyExpanded).toBe(false)

    await layOut(renderer)
    // The list's own offset, plus the card, less the pinned row over it.
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenLastCalledWith({
      y: 120 + 300 - 90,
      animated: false,
    })

    // A later layout pass (an expand, a delete) must not scroll again.
    await layOut(renderer)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("scrolls again when a later, different series arrives", async () => {
    mockDownloads.offlineRecords = TWO_SERIES
    mockParams.series = "series-b"
    const renderer = await renderScreen("ios")
    await layOut(renderer)
    expect(scrollTo).toHaveBeenCalledTimes(1)

    mockParams.series = "series-a"
    await act(async () => {
      renderer.update(<DownloadsScreen />)
    })

    expect(card(renderer, "series-a").props.initiallyExpanded).toBe(true)
    expect(scrollTo).toHaveBeenCalledTimes(2)
    expect(scrollTo).toHaveBeenLastCalledWith({
      y: 120 + 40 - 90,
      animated: false,
    })
    await unmount(renderer)
  })

  it("never scrolls to a series deleted after its card reported", async () => {
    mockDownloads.offlineRecords = TWO_SERIES
    const renderer = await renderScreen("ios")
    await layOut(renderer)

    mockDownloads.offlineRecords = TWO_SERIES.filter(
      (record) => record.seriesSlug !== "series-b",
    )
    await act(async () => {
      renderer.update(<DownloadsScreen />)
    })
    mockParams.series = "series-b"
    await act(async () => {
      renderer.update(<DownloadsScreen />)
    })

    // The map still holds series-b's old y; the scroll must not trust it.
    expect(scrollTo).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it.each([undefined, "no-such-series"])(
    "leaves every card collapsed and does not scroll for series=%s",
    async (series) => {
      mockDownloads.offlineRecords = TWO_SERIES
      if (series != null) mockParams.series = series
      const renderer = await renderScreen("ios")

      expect(card(renderer, "series-a").props.initiallyExpanded).toBe(false)
      expect(card(renderer, "series-b").props.initiallyExpanded).toBe(false)
      await layOut(renderer)
      expect(scrollTo).not.toHaveBeenCalled()
      await unmount(renderer)
    },
  )
})
