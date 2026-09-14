/**
 * Library's selection mode is the one place where `src/lib/tabBarVisibility`
 * and `app/(tabs)/_layout.ios.tsx` meet. `app/__tests__/tabBarLayout.test.tsx`
 * covers each half alone. A regression that drops either call HERE keeps the
 * whole suite green and strands the iOS tab bar hidden.
 *
 * The `react` re-points below follow the in-file pattern in
 * `src/components/profile/__tests__/AccountSection.test.tsx` (apps/mobile
 * CLAUDE.md, "Component render tests").
 */

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
// above these declarations and rejects any other out-of-scope name in a
// factory. Each factory reads them at RENDER time, never at factory time.
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

const mockRecords = [
  {
    version: 1,
    videoSlug: "the-birth-of-jesus",
    dubDocumentId: "dub-1",
    renditionDocumentId: "rendition-1",
    qualityLabel: "High",
    title: "The Birth of Jesus",
    subtitleLanguageSlug: null,
    state: "downloaded",
    committedPath: "/downloads/the-birth-of-jesus.mp4",
    pendingPath: null,
    posterPath: null,
    bytesWritten: 1024,
    totalBytes: 1024,
  },
]

jest.mock("../../../src/lib/tabBarVisibility", () => ({
  setTabBarHidden: jest.fn(),
  resetTabBarHidden: jest.fn(),
}))
jest.mock("expo-router", () => ({
  useNavigation: () => mockNavigation,
  useIsFocused: () => true,
  useRouter: () => ({ push: () => {} }),
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 83, left: 0 }),
}))
jest.mock("../../../src/contexts/DownloadsProvider", () => ({
  useDownloads: () => ({
    offlineRecords: mockRecords,
    isReady: true,
    deleteDownload: () => Promise.resolve(),
    retryDownload: () => Promise.resolve(),
    resumeDownload: () => Promise.resolve(),
  }),
}))
jest.mock("../../../src/contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => ({
    longPressHintSeen: true,
    setLongPressHintSeen: () => {},
    isReady: true,
  }),
}))
jest.mock("../../../src/lib/offlineFileSystem", () => ({
  totalDiskBytes: () => Promise.resolve(0),
}))
jest.mock("../../../src/lib/datadog", () => ({
  datadogLog: { info: () => {}, warn: () => {}, error: () => {} },
}))

// The downloads list is not under test here, and every one of these pulls a
// native module (expo-image, expo-blur, Ionicons) that this suite has no
// reason to load. The Select and Cancel controls live in library.tsx itself.
jest.mock("../../../src/components/library/DownloadRow", () => ({
  DownloadRow: () => null,
}))
jest.mock("../../../src/components/library/SeriesGroupCard", () => ({
  SeriesGroupCard: () => null,
}))
jest.mock("../../../src/components/library/StorageSummary", () => ({
  StorageSummary: () => null,
}))
jest.mock("../../../src/components/library/LibraryEmptyState", () => ({
  LibraryEmptyState: () => null,
}))
jest.mock("../../../src/components/library/SelectionActionBar", () => ({
  SelectionActionBar: () => null,
}))
jest.mock("../../../src/components/library/DeleteConfirmSheet", () => ({
  DeleteConfirmSheet: () => null,
}))
jest.mock("../../../src/components/ui/Snackbar", () => ({
  Snackbar: () => null,
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))

import { act } from "react"
import { Platform } from "react-native"

import LibraryScreen from "../library"
import { TAB_BAR_FLAT_STYLE } from "../../../src/lib/tabBar"
import {
  resetTabBarHidden,
  setTabBarHidden,
} from "../../../src/lib/tabBarVisibility"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

const mockedSetTabBarHidden = jest.mocked(setTabBarHidden)
const mockedResetTabBarHidden = jest.mocked(resetTabBarHidden)

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}

afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockedSetTabBarHidden.mockClear()
  mockedResetTabBarHidden.mockClear()
  mockNavigation.setOptions.mockClear()
  mockNavigation.addListener.mockClear()
  mockBlurListeners.length = 0
})

async function renderLibrary(os: "ios" | "android"): Promise<TestInstance> {
  setPlatform(os)
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<LibraryScreen />)
  })
  expect(hasText(renderer, "Library")).toBe(true)
  return renderer
}

/** The header swaps its controls on the selection flag, so the Cancel pill
 *  existing IS selection mode. The count Text renders a children ARRAY, so
 *  `hasText` cannot see it. */
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

describe("Library selection drives the iOS native tab bar", () => {
  it("hides the bar when selection starts", async () => {
    const renderer = await renderLibrary("ios")
    expect(mockedSetTabBarHidden).toHaveBeenLastCalledWith(false)
    mockedSetTabBarHidden.mockClear()

    await enterSelection(renderer)

    expect(mockedSetTabBarHidden).toHaveBeenLastCalledWith(true)
    await unmount(renderer)
  })

  it("shows the bar again when selection ends", async () => {
    const renderer = await renderLibrary("ios")
    await enterSelection(renderer)
    mockedSetTabBarHidden.mockClear()

    await press(pressableByLabel(renderer, "Cancel selection"))

    expect(mockedSetTabBarHidden).toHaveBeenLastCalledWith(false)
    expect(hasControl(renderer, "Cancel selection")).toBe(false)
    await unmount(renderer)
  })

  it("shows the bar again when the screen blurs mid-selection", async () => {
    const renderer = await renderLibrary("ios")
    await enterSelection(renderer)
    mockedSetTabBarHidden.mockClear()
    // Anti-vacuous: an empty registry would make the forEach below a no-op.
    expect(mockBlurListeners).toHaveLength(1)

    await act(async () => {
      mockBlurListeners.forEach((listener) => listener())
    })

    expect(mockedSetTabBarHidden).toHaveBeenLastCalledWith(false)
    expect(hasControl(renderer, "Cancel selection")).toBe(false)
    await unmount(renderer)
  })

  it("resets the bar on unmount, so a tab switch cannot strand it", async () => {
    const renderer = await renderLibrary("ios")
    await enterSelection(renderer)
    expect(mockedResetTabBarHidden).not.toHaveBeenCalled()

    await unmount(renderer)

    expect(mockedResetTabBarHidden).toHaveBeenCalled()
  })
})

describe("the setOptions lever is Android-only", () => {
  it("never writes a tabBarStyle on iOS", async () => {
    const renderer = await renderLibrary("ios")
    await enterSelection(renderer)
    await press(pressableByLabel(renderer, "Cancel selection"))
    await unmount(renderer)

    // UIKit's bar takes no style object; the flag travels UP through the
    // module store instead. The Android case below proves this harness does
    // record such a call, so the emptiness is not the harness.
    expect(tabBarStyleOptions()).toEqual([])
  })

  it("writes a tabBarStyle on Android, both directions", async () => {
    const renderer = await renderLibrary("android")
    await enterSelection(renderer)

    expect(mockNavigation.setOptions).toHaveBeenLastCalledWith({
      tabBarStyle: { display: "none" },
    })

    await press(pressableByLabel(renderer, "Cancel selection"))

    expect(mockNavigation.setOptions).toHaveBeenLastCalledWith({
      tabBarStyle: TAB_BAR_FLAT_STYLE,
    })
    await unmount(renderer)
  })
})
