/**
 * Pins BOTH navigators. iOS renders `_layout.ios.tsx` (NativeTabs, a real
 * UITabBarController); every other platform renders `_layout.tsx`, and Android
 * keeps the bar options it shipped before feat-500.
 *
 * `NativeTabs` comes from `expo-router/unstable-native-tabs`, NOT the
 * `expo-router` root, so mocking `expo-router` alone would load the real
 * native-tabs module under jest. Both paths are mocked below.
 */
import { act, createElement } from "react"
import type React from "react"
import { Platform } from "react-native"
import { NativeTabs } from "expo-router/unstable-native-tabs"

import {
  TestRenderer,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"
import { TAB_LABEL_KEYS, TAB_ROUTE_NAMES } from "../../src/lib/tabBar"
import {
  resetTabBarHidden,
  setTabBarHidden,
} from "../../src/lib/tabBarVisibility"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../src/i18n/localeStore"
import { getT } from "../../src/i18n/useT"
import { phoneLocales } from "../../src/test-utils/uiLocaleFixture"
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
const mockScreens: Array<{ name: string; options: Record<string, unknown> }> =
  []
const mockNativeProps: { current: Record<string, unknown> | undefined } = {
  current: undefined,
}
const mockTriggers: Array<Record<string, unknown>> = []
// Each navigator mock counts its own mounts, so a relabel can prove it kept
// the bar mounted.
const mockMounts = { tabs: 0, nativeTabs: 0 }
// jest-expo sets __DEV__, so the real gate is always open here.
const mockExploreAvailable = { current: true }
const mockGetLocales = jest.fn()

jest.mock("expo-router", () => ({
  Tabs: Object.assign(
    (props: {
      screenOptions?: Record<string, unknown>
      children?: unknown
    }) => {
      jest.requireActual("react").useEffect(() => {
        mockMounts.tabs += 1
      }, [])
      mockScreenOptions.current = props.screenOptions
      // Rendering children is load-bearing, as it is for NativeTabs below.
      return props.children as never
    },
    {
      Screen: (props: { name: string; options: Record<string, unknown> }) => {
        mockScreens.push(props)
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
        jest.requireActual("react").useEffect(() => {
          mockMounts.nativeTabs += 1
        }, [])
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
jest.mock("../../src/lib/explore/availability", () => ({
  isExploreAvailable: () => mockExploreAvailable.current,
}))
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
// A fixture `es` label per tab. A layout that spells its own label cannot
// produce these, so the label cases below prove the catalog is read.
jest.mock("../../src/i18n/catalogs.generated", () =>
  jest
    .requireActual("../../src/test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../src/i18n/catalogs.generated"),
      {
        es: {
          Tabs: {
            home: "Inicio",
            explore: "Explorar",
            search: "Buscar",
            bible: "Biblia",
            profile: "Perfil",
          },
        },
      },
    ),
)
jest.mock("../../src/i18n/pluralData.generated", () =>
  jest
    .requireActual("../../src/test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../src/i18n/pluralData.generated"),
      ["es"],
    ),
)

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
// Every suite case but the English ones runs in the fixture `es` catalog.
async function usePhoneLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
}
beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("es-ES"))
  startLocaleSync()
})
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockScreenOptions.current = undefined
  mockScreens.length = 0
  mockNativeProps.current = undefined
  mockTriggers.length = 0
  mockMounts.tabs = 0
  mockMounts.nativeTabs = 0
  mockExploreAvailable.current = true
  resetTabBarHidden()
})
afterAll(() => resetLocaleStoreForTests())

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

const SENTINEL_LABELS = ["Inicio", "Explorar", "Buscar", "Biblia", "Perfil"]
const ENGLISH_LABELS = ["Home", "Explore", "Search", "Bible", "Profile"]

/** The text inside a trigger's Label child. */
function triggerLabel(trigger: Record<string, unknown>): unknown {
  const children = trigger.children as Array<{
    type: unknown
    props: { children?: unknown }
  }>
  return children.find((child) => child.type === NativeTabs.Trigger.Label)
    ?.props.children
}

function trigger(name: string): Record<string, unknown> {
  const found = mockTriggers.find((t) => t.name === name)
  expect(found).toBeDefined()
  return found!
}

function screen(name: string): Record<string, unknown> {
  const found = mockScreens.find((s) => s.name === name)
  expect(found).toBeDefined()
  return found!.options
}

describe("the shared tab record (R1)", () => {
  it("names Explore second and Bible fourth, each with its label key", () => {
    expect(TAB_ROUTE_NAMES).toEqual([
      "index",
      "explore",
      "watch",
      "bible",
      "profile",
    ])
    expect(TAB_LABEL_KEYS).toEqual({
      index: "home",
      explore: "explore",
      watch: "search",
      bible: "bible",
      profile: "profile",
    })
  })

  it("reads the fixture catalog in this suite (positive control)", () => {
    const t = getT("Tabs")
    expect(TAB_ROUTE_NAMES.map((name) => t(TAB_LABEL_KEYS[name]))).toEqual(
      SENTINEL_LABELS,
    )
  })

  it("keeps the English labels in the English catalog", async () => {
    await usePhoneLanguage("en-US")
    setPlatform("ios")
    await renderIos()
    expect(mockTriggers.map(triggerLabel)).toEqual(ENGLISH_LABELS)
    setPlatform("android")
    await renderAndroid()
    expect(mockScreens.map((s) => s.options.title)).toEqual(ENGLISH_LABELS)
  })
})

// KTD2: the bar relabels in place. A remount would rebuild the tab
// controller and drop each tab's navigation state.
describe("a language change", () => {
  async function mountAndRelabel(
    layout: React.ComponentType,
    labels: () => unknown[],
  ): Promise<unknown[]> {
    await usePhoneLanguage("en-US")
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(createElement(layout))
    })
    expect(labels()).toEqual(ENGLISH_LABELS)
    mockTriggers.length = 0
    mockScreens.length = 0

    await usePhoneLanguage("es-ES")

    const relabelled = labels()
    renderer.unmount()
    return relabelled
  }

  it("relabels the iOS bar without a remount", async () => {
    setPlatform("ios")
    const labels = await mountAndRelabel(IosTabLayout, () =>
      mockTriggers.map(triggerLabel),
    )
    expect(labels).toEqual(SENTINEL_LABELS)
    expect(mockMounts.nativeTabs).toBe(1)
  })

  it("relabels the Android bar without a remount", async () => {
    setPlatform("android")
    const labels = await mountAndRelabel(AndroidTabLayout, () =>
      mockScreens.map((s) => s.options.title),
    )
    expect(labels).toEqual(SENTINEL_LABELS)
    expect(mockMounts.tabs).toBe(1)
  })
})

describe("iOS — the native bar", () => {
  it("declares every tab, in TAB_ROUTE_NAMES order", async () => {
    setPlatform("ios")
    await renderIos()
    expect(mockTriggers.map((t) => t.name)).toEqual([...TAB_ROUTE_NAMES])
  })

  it.each([true, false])(
    "opts every tab out of UIKit's automatic content inset (gate open: %p)",
    async (available) => {
      // The auto-inset only reaches a scroll view first in the subview chain —
      // on Home that is the horizontal hero pager, not the feed. The screens
      // pad themselves through `useTabBarClearance()` instead.
      setPlatform("ios")
      mockExploreAvailable.current = available
      await renderIos()
      // Anti-vacuous: forEach over an empty array passes.
      expect(mockTriggers).toHaveLength(TAB_ROUTE_NAMES.length)
      mockTriggers.forEach((t) =>
        expect(t.disableAutomaticContentInsets).toBe(true),
      )
    },
  )

  it("puts the Bible trigger after Search, with its own symbol (feat-553 R2)", async () => {
    setPlatform("ios")
    await renderIos()
    expect(mockTriggers).toHaveLength(TAB_ROUTE_NAMES.length)
    const bible = mockTriggers[3]!
    expect(bible.name).toBe("bible")
    expect(triggerParts(bible)).toEqual({
      sf: "book.closed.fill",
      label: "Biblia",
    })
    // Anti-vacuous: the neighbours keep theirs.
    expect(triggerParts(mockTriggers[2]!).label).toBe("Buscar")
    expect(triggerParts(mockTriggers[4]!).label).toBe("Perfil")
  })

  it("takes every label from the catalog", async () => {
    setPlatform("ios")
    await renderIos()
    expect(mockTriggers.map(triggerLabel)).toEqual(SENTINEL_LABELS)
  })

  // KTD16: `hidden`, never an absent trigger. An absent trigger lets expo-router
  // append the route file as an extra tab.
  it("hides only the Explore trigger while the gate is closed", async () => {
    setPlatform("ios")
    mockExploreAvailable.current = false
    await renderIos()
    expect(trigger("explore").hidden).toBe(true)
    const others = mockTriggers.filter((t) => t.name !== "explore")
    expect(others).toHaveLength(TAB_ROUTE_NAMES.length - 1)
    others.forEach((t) => expect(t.hidden).toBeFalsy())
  })

  it("shows the Explore trigger while the gate is open", async () => {
    setPlatform("ios")
    await renderIos()
    expect(trigger("explore").hidden).toBe(false)
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
    // The downloads list's selection mode is the one writer. NativeTabs has no
    // per-screen `tabBarStyle`, so the flag has to reach the LAYOUT.
    setPlatform("ios")
    expect((await renderIos()).hidden).toBe(false)
    setTabBarHidden(true)
    expect((await renderIos()).hidden).toBe(true)
  })
})

describe("Android — the JS bar", () => {
  it("declares every tab, in TAB_ROUTE_NAMES order", async () => {
    setPlatform("android")
    await renderAndroid()
    expect(mockScreens.map((s) => s.name)).toEqual([...TAB_ROUTE_NAMES])
  })

  it("takes every title from the catalog", async () => {
    setPlatform("android")
    await renderAndroid()
    expect(mockScreens.map((s) => s.options.title)).toEqual(SENTINEL_LABELS)
  })

  // KTD16: the route file stays, so the button hides through `href: null`.
  it("hides only the Explore button while the gate is closed", async () => {
    setPlatform("android")
    mockExploreAvailable.current = false
    await renderAndroid()
    expect(screen("explore").href).toBeNull()
    const others = mockScreens.filter((s) => s.name !== "explore")
    expect(others).toHaveLength(TAB_ROUTE_NAMES.length - 1)
    others.forEach((s) => expect(s.options.href).toBeUndefined())
  })

  it("shows the Explore button while the gate is open", async () => {
    setPlatform("android")
    await renderAndroid()
    // expo-router treats an undefined href as absent; only null hides.
    expect(screen("explore").href).toBeUndefined()
  })

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

  it("declares the Bible tab after Search, with its title and icon (feat-553 R2)", async () => {
    setPlatform("android")
    await renderAndroid()
    expect(mockScreens[3]?.name).toBe("bible")
    const options = screen("bible") as {
      title: string
      tabBarIcon: (p: { color: string; size: number }) => ElementLike
    }
    expect(options.title).toBe("Biblia")
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
