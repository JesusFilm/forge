/**
 * The downloads list's selection mode is the one place where `src/lib/tabBarVisibility`
 * and `app/(tabs)/_layout.ios.tsx` meet. The Profile tab hosts it under the
 * account card; there is no Library tab. `app/__tests__/tabBarLayout.test.tsx`
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

// A test that needs another manifest state writes here; afterEach restores it.
const mockDownloads: { offlineRecords: typeof mockRecords; isReady: boolean } =
  { offlineRecords: mockRecords, isReady: true }

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
    offlineRecords: mockDownloads.offlineRecords,
    isReady: mockDownloads.isReady,
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
jest.mock("../../../src/lib/datadog", () => ({
  datadogLog: { info: () => {}, warn: () => {}, error: () => {} },
}))

// The downloads list is not under test here, and every one of these pulls a
// native module (expo-image, expo-blur, Ionicons) that this suite has no
// reason to load. The Select and Cancel controls live in LibraryDownloads.tsx.
jest.mock("../../../src/components/library/DownloadRow", () => ({
  DownloadRow: () => null,
}))
jest.mock("../../../src/components/library/SeriesGroupCard", () => ({
  SeriesGroupCard: () => null,
}))
jest.mock("../../../src/components/library/DownloadsSummary", () => ({
  DownloadsSummary: () => null,
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
// AccountSection's own suite covers auth, session replay and the sign-in gate.
jest.mock("../../../src/components/profile/AccountSection", () => ({
  AccountSection: () => null,
}))
// NotificationTestIdSection's own suite covers the push test ID and its store.
jest.mock("../../../src/components/profile/NotificationTestIdSection", () => ({
  NotificationTestIdSection: () => null,
}))
jest.mock("../../../src/lib/openExternalUrl", () => ({
  openExternalUrl: jest.fn(),
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))

import { Children, act, isValidElement, type ReactNode } from "react"
import { Platform, ScrollView } from "react-native"

import ProfileScreen from "../profile"
import { LibraryEmptyState } from "../../../src/components/library/LibraryEmptyState"
import { AccountSection } from "../../../src/components/profile/AccountSection"
import { openExternalUrl } from "../../../src/lib/openExternalUrl"
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
  type RenderedNode,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

const mockedSetTabBarHidden = jest.mocked(setTabBarHidden)
const mockedResetTabBarHidden = jest.mocked(resetTabBarHidden)
const mockedOpenExternalUrl = jest.mocked(openExternalUrl)

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
  mockDownloads.offlineRecords = mockRecords
  mockDownloads.isReady = true
  mockedOpenExternalUrl.mockClear()
})

async function mountProfile(os: "ios" | "android"): Promise<TestInstance> {
  setPlatform(os)
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<ProfileScreen />)
  })
  return renderer
}

async function renderProfile(os: "ios" | "android"): Promise<TestInstance> {
  const renderer = await mountProfile(os)
  // The Select pill only exists on the ready-with-records branch, so it
  // proves the real downloads list mounted.
  expect(hasControl(renderer, "Select downloads")).toBe(true)
  return renderer
}

/** The head row swaps its controls on the selection flag, so the Cancel pill
 *  existing IS selection mode. The count Text renders a children ARRAY, so a
 *  text match cannot see it. */
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

describe("Profile selection drives the iOS bar", () => {
  it("hides the bar when selection starts", async () => {
    const renderer = await renderProfile("ios")
    expect(mockedSetTabBarHidden).toHaveBeenLastCalledWith(false)
    mockedSetTabBarHidden.mockClear()

    await enterSelection(renderer)

    expect(mockedSetTabBarHidden).toHaveBeenLastCalledWith(true)
    await unmount(renderer)
  })

  it("shows the bar again when selection ends", async () => {
    const renderer = await renderProfile("ios")
    await enterSelection(renderer)
    mockedSetTabBarHidden.mockClear()

    await press(pressableByLabel(renderer, "Cancel selection"))

    expect(mockedSetTabBarHidden).toHaveBeenLastCalledWith(false)
    expect(hasControl(renderer, "Cancel selection")).toBe(false)
    await unmount(renderer)
  })

  it("shows the bar again when the screen blurs mid-selection", async () => {
    const renderer = await renderProfile("ios")
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
    const renderer = await renderProfile("ios")
    await enterSelection(renderer)
    expect(mockedResetTabBarHidden).not.toHaveBeenCalled()

    await unmount(renderer)

    expect(mockedResetTabBarHidden).toHaveBeenCalled()
  })
})

describe("the setOptions lever is Android-only", () => {
  it("never writes a tabBarStyle on iOS", async () => {
    const renderer = await renderProfile("ios")
    await enterSelection(renderer)
    await press(pressableByLabel(renderer, "Cancel selection"))
    await unmount(renderer)

    // UIKit's bar takes no style object; the flag travels UP through the
    // module store instead. The Android case below proves this harness does
    // record such a call, so the emptiness is not the harness.
    expect(tabBarStyleOptions()).toEqual([])
  })

  it("writes a tabBarStyle on Android, both directions", async () => {
    const renderer = await renderProfile("android")
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

describe("the Profile tab", () => {
  /** Every rendered node, host and composite, in tree order. */
  function treeIndex(
    renderer: TestInstance,
    match: (node: RenderedNode) => boolean,
  ): number {
    return renderer.root.findAll(() => true).findIndex(match)
  }

  /** The stickyHeaderIndices the downloads list passes to its one ScrollView. */
  function stickyIndices(renderer: TestInstance): number[] | undefined {
    const views = renderer.root.findAll((node) => node.type === ScrollView)
    expect(views.length).toBe(1)
    return views[0]!.props.stickyHeaderIndices as number[] | undefined
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

  /** The child that pins. RN's ScrollView maps stickyHeaderIndices onto
   *  Children.toArray, which drops `false` slots, so this does the same. */
  function pinnedChild(renderer: TestInstance): ReactNode {
    const indices = stickyIndices(renderer)
    expect(indices?.length).toBe(1)
    const view = renderer.root.findAll((node) => node.type === ScrollView)[0]!
    return Children.toArray(view.props.children as ReactNode)[indices![0]!]
  }

  it("pins the Select row, not the account card, while the list scrolls", async () => {
    const renderer = await renderProfile("ios")

    expect(elementHasLabel(pinnedChild(renderer), "Select downloads")).toBe(
      true,
    )

    await enterSelection(renderer)
    expect(elementHasLabel(pinnedChild(renderer), "Cancel selection")).toBe(
      true,
    )
    await unmount(renderer)
  })

  it("puts the account card above the downloads", async () => {
    const renderer = await renderProfile("ios")

    const account = treeIndex(renderer, (node) => node.type === AccountSection)
    const select = treeIndex(
      renderer,
      (node) => node.props.accessibilityLabel === "Select downloads",
    )
    expect(account).toBeGreaterThanOrEqual(0)
    expect(account).toBeLessThan(select)
    await unmount(renderer)
  })

  it("hides the other external links and the old footer", async () => {
    const renderer = await renderProfile("ios")

    for (const label of [
      "X",
      "Facebook",
      "Instagram",
      "YouTube",
      "Give",
      "About",
      "Contact",
      "Sign Up For Our Newsletter",
      "Legal Statement",
    ]) {
      expect(hasControl(renderer, label)).toBe(false)
    }
    expect(hasText(renderer, "Jesus Film Project")).toBe(false)
    await unmount(renderer)
  })

  it("titles the downloads next to Select, until selection needs the row", async () => {
    const renderer = await renderProfile("ios")

    const title = treeIndex(
      renderer,
      (node) => node.props.children === "My Downloads",
    )
    const select = treeIndex(
      renderer,
      (node) => node.props.accessibilityLabel === "Select downloads",
    )
    expect(title).toBeGreaterThanOrEqual(0)
    expect(title).toBeLessThan(select)

    await enterSelection(renderer)
    expect(hasText(renderer, "My Downloads")).toBe(false)
    await unmount(renderer)
  })

  it("ends with a privacy policy button that opens the policy", async () => {
    const renderer = await renderProfile("ios")

    const select = treeIndex(
      renderer,
      (node) => node.props.accessibilityLabel === "Select downloads",
    )
    const privacy = treeIndex(
      renderer,
      (node) => node.props.accessibilityLabel === "Privacy Policy",
    )
    expect(privacy).toBeGreaterThan(select)

    await press(pressableByLabel(renderer, "Privacy Policy"))
    // A literal, not the constant: a changed URL must fail here.
    expect(mockedOpenExternalUrl).toHaveBeenCalledTimes(1)
    expect(mockedOpenExternalUrl).toHaveBeenCalledWith(
      "https://www.jesusfilm.org/privacy/",
    )
    await unmount(renderer)
  })

  it("shows the empty state under the account card with no downloads", async () => {
    mockDownloads.offlineRecords = []
    const renderer = await mountProfile("ios")

    const empties = renderer.root.findAll(
      (node) => node.type === LibraryEmptyState,
    )
    // Counts, not node arrays: a node diff on failure can exhaust jest's heap.
    expect(empties.length).toBe(1)
    const account = treeIndex(renderer, (node) => node.type === AccountSection)
    const empty = treeIndex(renderer, (node) => node.type === LibraryEmptyState)
    expect(account).toBeGreaterThanOrEqual(0)
    expect(account).toBeLessThan(empty)
    // Under a header the empty state must give up its full-screen top gap.
    expect(empties[0]!.props.style).toBeDefined()
    // No Select row exists, so nothing may pin.
    expect(stickyIndices(renderer)).toBeUndefined()
    expect(hasControl(renderer, "Select downloads")).toBe(false)
    expect(hasText(renderer, "My Downloads")).toBe(false)
    const privacy = treeIndex(
      renderer,
      (node) => node.props.accessibilityLabel === "Privacy Policy",
    )
    expect(privacy).toBeGreaterThan(empty)
    await unmount(renderer)
  })

  it("shows only the account card and privacy link until downloads load", async () => {
    // Records exist, so a missing Select control proves the isReady gate.
    mockDownloads.isReady = false
    const renderer = await mountProfile("ios")

    expect(
      treeIndex(renderer, (node) => node.type === AccountSection),
    ).toBeGreaterThanOrEqual(0)
    expect(hasControl(renderer, "Select downloads")).toBe(false)
    expect(hasText(renderer, "My Downloads")).toBe(false)
    expect(
      renderer.root.findAll((node) => node.type === LibraryEmptyState).length,
    ).toBe(0)
    expect(hasControl(renderer, "Privacy Policy")).toBe(true)
    expect(stickyIndices(renderer)).toBeUndefined()
    await unmount(renderer)
  })
})
