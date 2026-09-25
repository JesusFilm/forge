/**
 * Pins BOTH navigators. iOS renders `_layout.ios.tsx` (NativeTabs, a real
 * UITabBarController); every other platform renders `_layout.tsx`, and Android
 * must be byte-identical to what it shipped before feat-500.
 *
 * `NativeTabs` comes from `expo-router/unstable-native-tabs`, NOT the
 * `expo-router` root, so mocking `expo-router` alone would load the real
 * native-tabs module under jest. Both paths are mocked below.
 */
import { act } from "react"
import type React from "react"
import { Platform } from "react-native"

import {
  TestRenderer,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"
import { READER_COPY } from "../../src/lib/bible/reader/copy"
import { TAB_ROUTE_NAMES } from "../../src/lib/tabBar"
import {
  resetTabBarHidden,
  setTabBarHidden,
} from "../../src/lib/tabBarVisibility"
import IosTabLayout from "../(tabs)/_layout.ios"

// jest-expo runs the `ios` platform, so an extension-less import of
// "../(tabs)/_layout" resolves to the .ios SIBLING and every Android assertion
// below would silently test the native navigator instead. `require` with the
// explicit extension is the one form that bypasses platform resolution and
// that `allowImportingTsExtensions: false` still accepts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AndroidTabLayout = require("../(tabs)/_layout.tsx")
  .default as React.ComponentType

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockScreenOptions: { current: Record<string, unknown> | undefined } = {
  current: undefined,
}
const mockNativeProps: { current: Record<string, unknown> | undefined } = {
  current: undefined,
}
const mockTriggers: Array<Record<string, unknown>> = []
const mockAndroidScreens: Array<Record<string, unknown>> = []

jest.mock("expo-router", () => ({
  Tabs: Object.assign(
    (
      props: { screenOptions?: Record<string, unknown> } & {
        children?: unknown
      },
    ) => {
      mockScreenOptions.current = props.screenOptions
      // Rendered so each <Tabs.Screen> reports its props, as the triggers do.
      return props.children as never
    },
    {
      Screen: (props: Record<string, unknown>) => {
        mockAndroidScreens.push(props)
        return null
      },
    },
  ),
}))
jest.mock("expo-router/unstable-native-tabs", () => {
  const Trigger = Object.assign(
    (props: Record<string, unknown>) => {
      mockTriggers.push(props)
      return null
    },
    { Icon: () => null, Label: () => null },
  )
  return {
    NativeTabs: Object.assign(
      (props: Record<string, unknown> & { children?: unknown }) => {
        mockNativeProps.current = props
        // Rendering children is load-bearing: returning null here leaves
        // mockTriggers empty and every per-trigger assertion passes vacuously.
        return props.children as never
      },
      { Trigger },
    ),
  }
})
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockScreenOptions.current = undefined
  mockNativeProps.current = undefined
  mockTriggers.length = 0
  mockAndroidScreens.length = 0
  resetTabBarHidden()
})

type ElementLike = { props: Record<string, unknown> }

/** A trigger's Icon and Label, read from the elements it was given. */
function triggerParts(trigger: Record<string, unknown>) {
  const children = (
    Array.isArray(trigger.children) ? trigger.children : [trigger.children]
  ) as ElementLike[]
  const [icon, label] = children
  return { sf: icon?.props.sf, label: label?.props.children }
}

async function renderAndroid(): Promise<Record<string, unknown>> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<AndroidTabLayout />)
  })
  renderer.unmount()
  return mockScreenOptions.current!
}

async function renderIos(): Promise<Record<string, unknown>> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<IosTabLayout />)
  })
  renderer.unmount()
  return mockNativeProps.current!
}

describe("iOS — the native bar", () => {
  it("declares every tab, in TAB_ROUTE_NAMES order", async () => {
    setPlatform("ios")
    await renderIos()
    expect(mockTriggers.map((t) => t.name)).toEqual([...TAB_ROUTE_NAMES])
  })

  it("puts the Bible trigger third, with its own label and symbol (feat-551 R2)", async () => {
    setPlatform("ios")
    await renderIos()
    expect(mockTriggers).toHaveLength(5)
    const bible = mockTriggers[2]!
    expect(bible.name).toBe("bible")
    expect(triggerParts(bible)).toEqual({
      sf: "book.closed.fill",
      label: READER_COPY.tabTitle,
    })
    // Anti-vacuous: the neighbours keep theirs.
    expect(triggerParts(mockTriggers[1]!).label).toBe("Search")
    expect(triggerParts(mockTriggers[3]!).label).toBe("Library")
  })

  it("opts every tab out of UIKit's automatic content inset", async () => {
    // The auto-inset only reaches a scroll view first in the subview chain —
    // on Home that is the horizontal hero pager, not the feed. The screens pad
    // themselves through `useTabBarClearance()` instead.
    setPlatform("ios")
    await renderIos()
    // Anti-vacuous: forEach over an empty array passes.
    expect(mockTriggers).toHaveLength(TAB_ROUTE_NAMES.length)
    mockTriggers.forEach((t) =>
      expect(t.disableAutomaticContentInsets).toBe(true),
    )
  })

  it("keeps the app's ground below iOS 26, where the props still land", async () => {
    setPlatform("ios")
    const props = await renderIos()
    expect(props.backgroundColor).toBe("#1c1917")
    expect(props.blurEffect).toBe("systemChromeMaterialDark")
    // Without this the bar goes transparent wherever content meets its edge.
    expect(props.disableTransparentOnScrollEdge).toBe(true)
  })

  it("hides the bar only while the store says so", async () => {
    // The Library screen's selection mode is the one writer. NativeTabs has no
    // per-screen `tabBarStyle`, so the flag has to reach the LAYOUT.
    setPlatform("ios")
    expect((await renderIos()).hidden).toBe(false)
    setTabBarHidden(true)
    expect((await renderIos()).hidden).toBe(true)
  })
})

describe("Android — unchanged", () => {
  it("keeps today's flat opaque bar", async () => {
    setPlatform("android")
    const style = (await renderAndroid()).tabBarStyle as Record<string, unknown>
    expect(style).toEqual({
      backgroundColor: "#1c1917",
      borderTopColor: "transparent",
    })
  })

  it("supplies NO tabBarBackground option, so the bar keeps its own fill", async () => {
    setPlatform("android")
    // An element is non-null whatever it renders, and merely supplying the
    // option forces the bar's backgroundColor transparent. Android's opacity
    // must not rest on tabBarStyle alone.
    expect((await renderAndroid()).tabBarBackground).toBeUndefined()
  })

  it("leaves tabBarHideOnKeyboard unset, exactly as today", async () => {
    setPlatform("android")
    expect((await renderAndroid()).tabBarHideOnKeyboard).toBeUndefined()
  })

  it("declares the Bible tab third, with its title and icon (feat-551 R2)", async () => {
    setPlatform("android")
    await renderAndroid()
    expect(mockAndroidScreens.map((s) => s.name)).toEqual([...TAB_ROUTE_NAMES])
    const bible = mockAndroidScreens[2]!
    const options = bible.options as {
      title: string
      tabBarIcon: (p: { color: string; size: number }) => ElementLike
    }
    expect(options.title).toBe(READER_COPY.tabTitle)
    expect(options.tabBarIcon({ color: "#fff", size: 24 }).props.name).toBe(
      "book",
    )
  })

  it("keeps its own tint colours", async () => {
    setPlatform("android")
    const options = await renderAndroid()
    expect(options.tabBarActiveTintColor).toBe("#CB333B")
    expect(options.tabBarInactiveTintColor).toBe("#a8a29e")
  })
})
