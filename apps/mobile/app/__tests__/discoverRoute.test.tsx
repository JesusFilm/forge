/**
 * The Discover tab is a folder with its own nested navigator (feat-699 U13,
 * KTD9), beside the root `app/watch/` player folder. Both answer to "watch".
 * The route tree comes from the real `app/` files; the real Discover layouts
 * render, and every other route is a stub.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// expo-router's renderRouter needs @testing-library/react-native, which this
// app does not install. This stand-in renders with the react-test-renderer
// the other suites use; afterEach unmounts, as the real library does.
const mockRendered: TestInstance[] = []
jest.mock(
  "@testing-library/react-native",
  () => {
    const { act } = require("react") as typeof import("react")
    const { TestRenderer } =
      require("../../src/test-utils/rnTestRenderer") as typeof import("../../src/test-utils/rnTestRenderer")
    return {
      act,
      render(element: React.ReactElement) {
        let renderer!: TestInstance
        act(() => {
          renderer = TestRenderer.create(element)
        })
        mockRendered.push(renderer)
        return renderer
      },
      // expo-router copies this getter at import, before mockRendered exists.
      get screen() {
        return mockRendered?.at(-1)
      },
    }
  },
  { virtual: true },
)

// The real expo-router imports this ESM-only package, which the jest
// transform skips. This is its whole source (standard-navigation 0.0.5).
jest.mock("standard-navigation", () => ({
  createStandardNavigator: (NavigatorContent: unknown) => ({
    type: "standard",
    version: 1,
    NavigatorContent,
  }),
}))

const mockGlass = { available: false }
jest.mock("../../src/lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGlass.available,
}))
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => false,
  isGlassEffectAPIAvailable: () => false,
}))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// Only the real Discover case reaches these: it renders with no search sent.
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("../../src/lib/apolloClient", () => ({
  getApolloClient: () => ({ query: jest.fn() }),
}))
jest.mock("../../src/contexts/ExperienceSelectionProvider", () => ({
  useExperienceSelection: () => ({ selectExperience: () => {} }),
}))
jest.mock("../../src/components/search/BrowseTopics", () => ({
  BrowseTopics: () => null,
}))

import { act } from "react"
import type React from "react"
import { Platform, Text } from "react-native"
import {
  Stack,
  Tabs,
  router,
  useIsFocused,
  useLocalSearchParams,
} from "expo-router"
import {
  renderRouter,
  type MockContextConfig,
} from "expo-router/testing-library"

import { HomeHeader } from "../../src/components/ui/HomeHeader"
import { getT } from "../../src/i18n/useT"
import { resolveViewName } from "../../src/lib/datadog"
import {
  isFullScreenRoute,
  isTabRootRoute,
} from "../../src/lib/miniPlayer/presentation"
import { isTabGroupRoute } from "../../src/lib/tabBar"
import {
  hasText,
  pressableByLabel,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"

declare const __dirname: string
type Dirent = { name: string; isDirectory(): boolean }
const fs = jest.requireActual<{
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[]
}>("fs")

const APP_DIR = `${__dirname}/..`

/** Every route file under app/, as expo-router keys it: no extension. */
function routeKeys(dir = ""): string[] {
  return fs
    .readdirSync(dir ? `${APP_DIR}/${dir}` : APP_DIR, { withFileTypes: true })
    .flatMap((entry) => {
      const key = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : routeKeys(key)
      }
      if (!/\.[jt]sx?$/.test(entry.name) || entry.name.startsWith("+")) {
        return []
      }
      return [key.replace(/\.[jt]sx?$/, "")]
    })
}

function Blank() {
  return null
}

// Discover's preview fetches stop on this value (useSearchPreviewCycle).
function DiscoverStub() {
  return <Text>{`discover-screen focused:${useIsFocused()}`}</Text>
}

function PlayerStub() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  return <Text>{`player:${slug}`}</Text>
}

// Experience screens show this header with the search button on the left.
function HomeStub() {
  return <HomeHeader title={null} titleOpacity={0} />
}

function StackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}

// The app's iOS bar is NativeTabs, which needs UIKit; a JS tab navigator
// gives the same route tree.
function TabsLayout() {
  return <Tabs screenOptions={{ headerShown: false }} />
}

/** The Discover folder's own layouts render for real. */
const REAL_ROUTES = new Set([
  "(tabs)/watch/_layout",
  "(tabs)/watch/_layout.ios",
])

const STUBS: Record<string, React.ComponentType> = {
  "(tabs)/_layout": TabsLayout,
  "(tabs)/_layout.ios": TabsLayout,
  "(tabs)/index": HomeStub,
  // The single-file tab from before U13, so the test still runs against it.
  "(tabs)/watch": DiscoverStub,
  "(tabs)/watch/index": DiscoverStub,
  "watch/[slug]": PlayerStub,
}

function appContext(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    routeKeys().map((key) => {
      if (key in overrides) return [key, overrides[key]]
      if (REAL_ROUTES.has(key)) {
        return [key, require(`${APP_DIR}/${key}.tsx`)]
      }
      const stub =
        STUBS[key] ?? (/(^|\/)_layout(\.\w+)?$/.test(key) ? StackLayout : Blank)
      return [key, stub]
    }),
  )
}

// The stand-in's renderer plus the route readers renderRouter adds to it.
type Screen = TestInstance & {
  getPathname(): string
  getSegments(): string[]
  getRouterState(): unknown
}

function open(
  initialUrl: string,
  overrides: Record<string, unknown> = {},
): Screen {
  return renderRouter(appContext(overrides) as MockContextConfig, {
    initialUrl,
  }) as unknown as Screen
}

/** The nested state of the Discover route inside the tab navigator. */
function discoverRoutes(screen: Screen): string[] | undefined {
  type State = { routes: { name: string; state?: State }[] }
  const root = screen.getRouterState() as unknown as State
  const stack = root.routes.find((r) => r.name === "__root")?.state
  const tabs = stack?.routes.find((r) => r.name === "(tabs)")?.state
  const discover = tabs?.routes.find((r) => r.name === "watch")?.state
  return discover?.routes.map((r) => r.name)
}

function nativeStackCount(screen: Screen): number {
  return screen.root.findAll((node) => node.type === "RNSScreenStack").length
}

/** Each native header below the root stack's own "(tabs)" screen. */
function nestedHeaders(screen: Screen) {
  return screen.root
    .findAll((node) => node.type === "RNSScreenStackHeaderConfig")
    .filter((node) => node.props.title !== "(tabs)")
    .map(({ props }) => ({
      hidden: props.hidden,
      translucent: props.translucent,
      title: props.title,
    }))
}

/** What the mini player back handler and Datadog read for this route. */
function expectDiscoverReaders(screen: Screen) {
  const segments = screen.getSegments()
  expect(segments).toEqual(["(tabs)", "watch"])
  expect(screen.getPathname()).toBe("/watch")
  expect(resolveViewName(segments, screen.getPathname()).name).toBe(
    "(tabs)/watch",
  )
  expect(isTabRootRoute(segments)).toBe(true)
  expect(isTabGroupRoute(segments)).toBe(true)
  expect(hasText(screen, "discover-screen")).toBe(true)
}

const platformOs = Object.getOwnPropertyDescriptor(Platform, "OS")!

afterEach(() => {
  act(() => {
    mockRendered.splice(0).forEach((renderer) => renderer.unmount())
  })
  Object.defineProperty(Platform, "OS", platformOs)
  mockGlass.available = false
})

// KTD9: a Stack on iOS, with a transparent untitled header only on Liquid
// Glass; a Slot on Android, which adds no navigator and no header.
const SHOWN_HEADER = { hidden: false, translucent: true, title: "" }
const HIDDEN_HEADER = { ...SHOWN_HEADER, hidden: true }

describe.each([
  ["ios", true, 2, [SHOWN_HEADER]],
  ["ios", false, 2, [HIDDEN_HEADER]],
  ["android", false, 1, []],
] as const)(
  "the Discover route on %s (Liquid Glass: %p)",
  (os, glass, stacks, headers) => {
    beforeEach(() => {
      Object.defineProperty(Platform, "OS", { value: os, configurable: true })
      mockGlass.available = glass
    })

    it("opens Discover at /watch, with the segments its readers expect", () => {
      const screen = open("/watch")
      expectDiscoverReaders(screen)
      expect(discoverRoutes(screen)).toEqual(["index"])
      // The root stack, plus Discover's own on iOS. A stub layout in place of
      // the real files would give 2 on Android as well.
      expect(nativeStackCount(screen)).toBe(stacks)
      expect(nestedHeaders(screen)).toEqual(headers)
    })

    it("reports Discover unfocused while another tab is open", () => {
      const screen = open("/watch")
      expect(hasText(screen, "discover-screen focused:true")).toBe(true)
      act(() => {
        router.navigate("/(tabs)/profile")
      })
      expect(screen.getSegments()).toEqual(["(tabs)", "profile"])
      // Still mounted, as under the real bar, and now unfocused.
      expect(hasText(screen, "discover-screen focused:false")).toBe(true)
      act(() => {
        router.navigate("/(tabs)/watch")
      })
      expect(hasText(screen, "discover-screen focused:true")).toBe(true)
    })

    it("opens Discover from the header's search button", () => {
      const screen = open("/")
      expect(screen.getSegments()).toEqual(["(tabs)"])
      const search = pressableByLabel(screen, getT("Common")("searchAriaLabel"))
      act(() => {
        search!.props.onPress!()
      })
      expectDiscoverReaders(screen)
    })

    it("still opens the root player at /watch/<slug>", () => {
      const screen = open("/watch/the-birth-of-jesus")
      const segments = screen.getSegments()
      expect(segments).toEqual(["watch", "[slug]"])
      expect(screen.getPathname()).toBe("/watch/the-birth-of-jesus")
      expect(isFullScreenRoute(segments)).toBe(true)
      expect(isTabGroupRoute(segments)).toBe(false)
      expect(hasText(screen, "player:the-birth-of-jesus")).toBe(true)
      expect(hasText(screen, "discover-screen")).toBe(false)
    })

    it("opens a result's player over Discover, and Back returns to Discover", () => {
      const screen = open("/watch")
      act(() => {
        router.push("/watch/the-birth-of-jesus?seed=abc")
      })
      expect(screen.getSegments()).toEqual(["watch", "[slug]"])
      expect(hasText(screen, "player:the-birth-of-jesus")).toBe(true)
      act(() => {
        router.back()
      })
      expectDiscoverReaders(screen)
    })
  },
)

// The screen suite mocks Stack.SearchBar. This case proves the real one lands
// in Discover's own header, which only the iOS stack provides.
describe("the real Discover screen on iOS with Liquid Glass", () => {
  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true })
    mockGlass.available = true
  })

  it("puts the native search field in Discover's shown header", () => {
    const discover = require(`${APP_DIR}/(tabs)/watch/index.tsx`)
    const screen = open("/watch", { "(tabs)/watch/index": discover })
    expect(screen.getSegments()).toEqual(["(tabs)", "watch"])
    const bars = screen.root.findAll((node) => node.type === "RNSSearchBar")
    expect(bars.length).toBe(1)
    expect(bars[0]!.props).toMatchObject({
      placement: "automatic",
      placeholder: getT("Discover")("searchPlaceholder"),
      autoCapitalize: "none",
    })
    expect(nestedHeaders(screen)).toEqual([SHOWN_HEADER])
  })
})
