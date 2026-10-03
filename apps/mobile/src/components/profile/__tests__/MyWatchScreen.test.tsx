// The My Watch tab page (U7): top bar, the real header, then the rail or the
// empty message. `react` is re-pointed at the real package (apps/mobile
// CLAUDE.md, "Component render tests").
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
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("@datadog/mobile-react-native-session-replay", () => ({
  SessionReplayView: {
    MaskAll: function MockMaskAll({ children }: { children?: unknown }) {
      return children
    },
  },
}))
jest.mock("expo-image", () => ({
  __esModule: true,
  Image: function MockImage() {
    return null
  },
}))
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: function MockLinearGradient() {
    return null
  },
}))
jest.mock("../../watch/DownloadProgressRing", () => ({
  DownloadProgressRing: function MockRing() {
    return null
  },
}))
const mockRouter = {
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  navigate: jest.fn(),
  push: jest.fn(),
}
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}))
// A tab screen on a notched iPhone: 34pt home indicator plus the 49pt bar.
const mockInsets = { top: 59, right: 0, bottom: 83, left: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
jest.mock("../../../lib/authActions", () => ({
  signInWithHostedPage: jest.fn(),
}))
jest.mock("../../../lib/authSession", () => {
  // Stable snapshot identity: useSyncExternalStore loops on a fresh object.
  const snapshot = { status: "signedOut", user: null }
  return {
    getAuthSession: () => ({
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    }),
  }
})
const mockSignInGate = { open: false }
jest.mock("../../../lib/signInGate", () => ({
  isSignInAvailable: () => mockSignInGate.open,
}))
// The UI tag alone moves the direction style; the catalog stays English.
let mockUiTag = "en"
jest.mock("../../../hooks/useUiTag", () => ({
  useUiTag: () => mockUiTag,
}))
const mockDownloads: {
  offlineRecords: OfflineDownloadRecord[]
  isReady: boolean
} = { offlineRecords: [], isReady: true }
jest.mock("../../../contexts/DownloadsProvider", () => ({
  useDownloads: () => mockDownloads,
}))

import { act } from "react"
import { ScrollView, StyleSheet, type ViewStyle } from "react-native"

import { MyWatchScreen } from "../MyWatchScreen"
import { ScreenTopBar } from "../../ui/ScreenTopBar"
import { DownloadProgressRing } from "../../watch/DownloadProgressRing"
import { tabBarClearanceFor } from "../../../lib/tabBar"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
  type OfflineDownloadState,
} from "../../../lib/offlineManifest"
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
} from "../../../test-utils/rnTestRenderer"

const MB = 1024 * 1024
const EMPTY_HEADING = "No Downloads Yet"
const SEE_ALL_LABEL = "See all downloads"
const TILE_ACTION = "my-watch-download-tile"

function record(
  videoSlug: string,
  state: OfflineDownloadState,
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug,
    dubDocumentId: "dub",
    renditionDocumentId: "rend",
    qualityLabel: "High",
    title: videoSlug,
    subtitleLanguageSlug: null,
    state,
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: state === "downloaded" ? 10 * MB : 0,
    totalBytes: 10 * MB,
    ...overrides,
  }
}

function episode(index: number, enqueuedAt: number): OfflineDownloadRecord {
  return record(`birth-episode-${index}`, "downloaded", {
    title: `Birth Episode ${index}`,
    seriesSlug: "birth-of-jesus",
    seriesTitle: "Birth of Jesus",
    seriesEpisodeIndex: index,
    enqueuedAt,
  })
}

async function renderScreen(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<MyWatchScreen />)
  })
  return renderer
}

/** The tile controls in tree order. The host view below each has no onPress. */
function tiles(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll(
    (node) =>
      node.props["dd-action-name"] === TILE_ACTION &&
      typeof node.props.onPress === "function",
  )
}

function tileByLabel(renderer: TestInstance, label: string): RenderedNode {
  const matches = tiles(renderer).filter(
    (node) => node.props.accessibilityLabel === label,
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

function rings(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll((node) => node.type === DownloadProgressRing)
}

function hasExactText(renderer: TestInstance, text: string): boolean {
  return (
    renderer.root.findAll((node) => node.props.children === text).length > 0
  )
}

function expectNoInformationRows(renderer: TestInstance) {
  for (const text of [
    "Privacy Policy",
    "Give",
    "Version",
    "About",
    "Contact",
    "Legal",
  ]) {
    expect(hasText(renderer, text)).toBe(false)
  }
}

beforeEach(() => {
  mockRouter.navigate.mockReset()
  mockRouter.push.mockReset()
  mockSignInGate.open = false
  mockDownloads.offlineRecords = []
  mockDownloads.isReady = true
  mockUiTag = "en"
})

describe("MyWatchScreen with no downloads (R1, R2, R9)", () => {
  it("gate closed, records ready: menu control, Guest header, the empty message, no rail (AE1)", async () => {
    const renderer = await renderScreen()

    // The page shows no title: the tab bar item already names it.
    expect(hasExactText(renderer, "My Watch")).toBe(false)
    expect(pressableByLabel(renderer, "More")).toBeDefined()
    expect(hasExactText(renderer, "Guest")).toBe(true)
    expect(hasExactText(renderer, "Sign in · coming soon")).toBe(true)
    expect(hasExactText(renderer, EMPTY_HEADING)).toBe(true)
    expect(tiles(renderer).length).toBe(0)
    expect(hasExactText(renderer, "Downloads")).toBe(false)
    expect(
      renderer.root.findAll(
        (node) => node.props.accessibilityLabel === SEE_ALL_LABEL,
      ).length,
    ).toBe(0)
    expectNoInformationRows(renderer)
    await unmount(renderer)
  })

  it("records not ready: shows neither the rail nor the empty message (R9)", async () => {
    mockDownloads.isReady = false
    mockDownloads.offlineRecords = [record("v-1", "downloaded")]
    const renderer = await renderScreen()

    expect(hasExactText(renderer, "Guest")).toBe(true)
    expect(hasExactText(renderer, EMPTY_HEADING)).toBe(false)
    expect(tiles(renderer).length).toBe(0)
    expect(hasExactText(renderer, "Downloads")).toBe(false)
    await unmount(renderer)
  })

  it("the page scroll content clears the tab bar", async () => {
    const renderer = await renderScreen()
    const pageScrolls = renderer.root.findAll(
      (node) => node.type === ScrollView && node.props.horizontal !== true,
    )

    expect(pageScrolls.length).toBeGreaterThan(0)
    const content = StyleSheet.flatten(
      pageScrolls[0].props.contentContainerStyle as ViewStyle,
    )
    expect(Number(content.paddingBottom)).toBeGreaterThanOrEqual(
      tabBarClearanceFor(mockInsets),
    )
    await unmount(renderer)
  })

  it("floats the menu bar, so the header starts just under the safe area", async () => {
    const renderer = await renderScreen()
    const [page] = renderer.root.findAll(
      (node) => node.type === ScrollView && node.props.horizontal !== true,
    )
    const content = StyleSheet.flatten(
      page.props.contentContainerStyle as ViewStyle,
    )

    expect(
      renderer.root.findAll(
        (node) => node.type === ScreenTopBar && node.props.overlay === true,
      ).length,
    ).toBe(1)
    // The page clears the inset itself, because the overlaid bar takes no row.
    // The list starts below the inset, not at 0, so Android's position sort
    // puts the bar's More button first for a screen reader.
    expect(
      Number(StyleSheet.flatten(page.props.style as ViewStyle).marginTop),
    ).toBe(mockInsets.top)
    expect(Number(content.paddingTop)).toBe(16)
    await unmount(renderer)
  })
})

describe("MyWatchScreen under a large text size", () => {
  it("wraps See all under the Downloads heading instead of off the screen", async () => {
    mockDownloads.offlineRecords = [record("v-1", "downloaded")]
    const renderer = await renderScreen()
    const [heading] = renderer.root.findAll(
      (node) =>
        node.props.accessibilityRole === "header" &&
        node.props.children === "Downloads",
    )
    const [seeAll] = renderer.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "See all downloads" &&
        typeof node.props.onPress === "function",
    )
    const row = heading.parent!

    expect(seeAll.parent).toBe(row)
    expect(StyleSheet.flatten(row.props.style as ViewStyle).flexWrap).toBe(
      "wrap",
    )
    await unmount(renderer)
  })
})

describe("MyWatchScreen with downloads (R5, R6, R7, R21)", () => {
  it("renders four tiles in the selector's order, and the in-progress tile shows its ring (AE2)", async () => {
    mockDownloads.offlineRecords = [
      record("v-2", "downloaded", { enqueuedAt: 200 }),
      record("v-3", "downloading", {
        enqueuedAt: 300,
        bytesWritten: 3 * MB,
      }),
      record("v-1", "downloaded", { enqueuedAt: 100 }),
      record("v-4", "downloaded", { enqueuedAt: 400 }),
    ]
    const renderer = await renderScreen()

    expect(hasExactText(renderer, "Downloads")).toBe(true)
    expect(pressableByLabel(renderer, SEE_ALL_LABEL)).toBeDefined()
    expect(hasExactText(renderer, EMPTY_HEADING)).toBe(false)
    expect(
      tiles(renderer).map((node) => node.props.accessibilityLabel),
    ).toEqual([
      "v-4, Downloaded",
      "v-3, Downloading, 30%",
      "v-2, Downloaded",
      "v-1, Downloaded",
    ])
    expect(rings(renderer).length).toBe(1)
    expect(rings(renderer)[0].props.progress).toBeCloseTo(0.3)
    expectNoInformationRows(renderer)
    await unmount(renderer)
  })

  it("a video tile tap opens the watch route, the same path as a list-row tap (R6)", async () => {
    mockDownloads.offlineRecords = [record("the-birth of jesus", "downloaded")]
    const renderer = await renderScreen()

    await press(tileByLabel(renderer, "the-birth of jesus, Downloaded"))

    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledWith(
      "/watch/the-birth%20of%20jesus",
    )
    expect(mockRouter.push).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("a series tile tap opens Downloads at that series (R6, KTD5)", async () => {
    mockDownloads.offlineRecords = [episode(1, 10), episode(2, 20)]
    const renderer = await renderScreen()

    await press(tileByLabel(renderer, "Birth of Jesus, 2 episodes, Downloaded"))

    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledWith({
      pathname: "/downloads",
      params: { series: "birth-of-jesus" },
    })
    expect(mockRouter.push).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("a one-episode series is a video tile that opens that episode (AE7, R21)", async () => {
    mockDownloads.offlineRecords = [episode(3, 10)]
    const renderer = await renderScreen()

    expect(tiles(renderer).length).toBe(1)
    expect(hasText(renderer, "episodes")).toBe(false)
    await press(tileByLabel(renderer, "Birth Episode 3, Downloaded"))

    expect(mockRouter.navigate).toHaveBeenCalledWith("/watch/birth-episode-3")
    await unmount(renderer)
  })

  it("a failed tile's label says Failed; queued and paused say theirs (R7)", async () => {
    mockDownloads.offlineRecords = [
      record("bad", "failed", { enqueuedAt: 3 }),
      record("wait", "queued", { enqueuedAt: 2 }),
      record("hold", "paused", { enqueuedAt: 1 }),
    ]
    const renderer = await renderScreen()

    expect(
      tiles(renderer).map((node) => node.props.accessibilityLabel),
    ).toEqual(["bad, Failed", "wait, Queued", "hold, Paused"])
    await unmount(renderer)
  })
})

describe("MyWatchScreen exits (KTD12)", () => {
  it("See all opens /downloads, and the menu control opens /more", async () => {
    mockDownloads.offlineRecords = [record("v-1", "downloaded")]
    const renderer = await renderScreen()

    await press(pressableByLabel(renderer, SEE_ALL_LABEL))
    expect(mockRouter.navigate).toHaveBeenLastCalledWith("/downloads")
    await press(pressableByLabel(renderer, "More"))
    expect(mockRouter.navigate).toHaveBeenLastCalledWith("/more")

    expect(mockRouter.navigate).toHaveBeenCalledTimes(2)
    expect(mockRouter.push).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("a double tap on See all only ever navigates, so it opens one screen", async () => {
    mockDownloads.offlineRecords = [record("v-1", "downloaded")]
    const renderer = await renderScreen()
    const seeAll = pressableByLabel(renderer, SEE_ALL_LABEL)

    await act(async () => {
      seeAll.props.onPress?.()
      seeAll.props.onPress?.()
    })

    expect(mockRouter.navigate).toHaveBeenCalledTimes(2)
    for (const call of mockRouter.navigate.mock.calls) {
      expect(call).toEqual(["/downloads"])
    }
    expect(mockRouter.push).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })
})

describe("MyWatchScreen in a right-to-left UI (KTD13)", () => {
  function headingDirection(renderer: TestInstance) {
    const [heading] = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "header" &&
        node.props.children === "Downloads",
    )
    expect(heading).toBeDefined()
    const flat = StyleSheet.flatten(heading!.props.style as never) as {
      direction?: unknown
      writingDirection?: unknown
    }
    return {
      direction: flat.direction,
      writingDirection: flat.writingDirection,
    }
  }

  it("gives the Downloads heading the UI direction, and none in English", async () => {
    mockDownloads.offlineRecords = [record("v-1", "downloaded")]
    const english = await renderScreen()
    expect(headingDirection(english)).toEqual({
      direction: undefined,
      writingDirection: undefined,
    })
    await unmount(english)

    mockUiTag = "ar"
    const arabic = await renderScreen()
    expect(headingDirection(arabic)).toEqual({
      direction: "rtl",
      writingDirection: "rtl",
    })
    await unmount(arabic)
  })

  it("keeps the menu control's tap name whatever its label reads", async () => {
    const renderer = await renderScreen()
    expect(pressableByLabel(renderer, "More").props["dd-action-name"]).toBe(
      "my-watch-more",
    )
    await unmount(renderer)
  })
})
