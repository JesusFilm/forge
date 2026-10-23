// feat-787 KTD5: the release check's settings probe tells a live Home body
// from the frozen fallback by this testID. useWatchHome's suite pins the
// ladder that sets `bodySource`.

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}))
jest.mock("../../../hooks/useHomeRecommendations", () => ({
  useHomeRecommendations: () => ({
    status: "idle",
    slate: null,
    reportShelfMounted: jest.fn(),
    reportShelfVisible: jest.fn(),
    reportVisibleCards: jest.fn(),
    reportShelfDetached: jest.fn(),
    recordRender: jest.fn(),
    select: jest.fn(async () => null),
    refresh: jest.fn(),
  }),
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// A host stand-in that keeps the testID, which FlashList hands to its
// ScrollView (`...rest` in its RecyclerView).
jest.mock("@shopify/flash-list", () => {
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  return {
    FlashList: (props: { testID?: string }) =>
      createElement("MockFlashList", { testID: props.testID }),
  }
})
jest.mock("expo-image", () => {
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  const Image = (props: object) => createElement("ExpoImage", props)
  Image.prefetch = () => Promise.resolve(true)
  return { __esModule: true, Image }
})
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useNavigation: () => ({
    addListener: () => () => {},
    isFocused: () => true,
  }),
  useSegments: () => ["(tabs)", "index"],
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))
jest.mock("../HomeHeroPager", () => ({
  HERO_CHROME_BOTTOM: 0,
  HERO_CTA_HEIGHT: 0,
  HomeHeroPager: () => null,
}))
jest.mock("../HomeShelf", () => ({ HomeShelf: () => null }))
jest.mock("../HomeMissionSection", () => ({ HomeMissionSection: () => null }))
jest.mock("../HomeHeroSelectorRail", () => ({
  HomeHeroSelectorRail: () => null,
}))
jest.mock("../../ui/HomeHeader", () => ({ HomeHeader: () => null }))
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
}))
jest.mock("../../../hooks/useMiniPlayerHoldsVideo", () => ({
  useMiniPlayerHoldsVideo: () => false,
}))
jest.mock("../../../lib/miniPlayer/heroYield", () => ({
  heroPlaybackPaused: () => false,
}))
jest.mock("../../../hooks/useWatchHomeCarouselMemory", () => ({
  useWatchHomeCarouselMemory: () => ({
    playedIdsRef: { current: new Set<string>() },
    startPoolIndexRef: { current: 0 },
    hydrated: true,
    markVideoPlayed: jest.fn(),
    resetPlayedIds: jest.fn(),
    persistActiveSlide: jest.fn(),
  }),
}))
jest.mock("../../../hooks/useWatchHome", () => ({ useWatchHome: jest.fn() }))
jest.mock("../../../lib/watchHome/carouselSequence", () => ({
  buildWatchHomeHeroQueue: () => ({
    slides: [{ kind: "video", id: "v1", slug: "jesus", title: "JESUS" }],
    wrapped: false,
    videos: [],
  }),
  muxSlideDisplayCopy: () => ({ action: null }),
}))
jest.mock("../../../lib/splash/splashSession", () => ({
  getSplashSession: () => ({
    reportHomeContent: () => {},
    retractHomeContent: () => {},
    reportHomeFailure: () => {},
    retractHomeFailure: () => {},
  }),
}))

import { act, createElement } from "react"
import { Animated } from "react-native"

import { HomeScreen } from "../HomeScreen"
import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import type { WatchHomeBodySource } from "../../../hooks/useWatchHome"
import type { WatchHomeModel } from "../../../lib/watchHome/model"

const { useWatchHome } = jest.requireMock("../../../hooks/useWatchHome") as {
  useWatchHome: jest.Mock
}

function setHome(bodySource: WatchHomeBodySource) {
  useWatchHome.mockReturnValue({
    model: {
      sections: [],
      carousel: { pools: [], muxInserts: [] },
    } as unknown as WatchHomeModel,
    recommendationsInsertIndex: null,
    bodySource,
    loading: false,
    refreshing: false,
    error: null,
    refetch: jest.fn(),
  })
}

function render(): TestInstance {
  let renderer: TestInstance | undefined
  act(() => {
    renderer = TestRenderer.create(
      createElement(HomeScreen, { testID: "screen-tab-home" }),
    )
  })
  if (!renderer) throw new Error("render failed")
  return renderer
}

function hostTestIds(renderer: TestInstance): string[] {
  return renderer.root
    .findAll(
      (n) => typeof n.type === "string" && typeof n.props.testID === "string",
    )
    .map((n) => n.props.testID as string)
}

let timing: jest.SpyInstance

beforeEach(() => {
  timing = jest.spyOn(Animated, "timing").mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
    reset: jest.fn(),
  } as unknown as Animated.CompositeAnimation)
})

afterEach(() => {
  timing.mockRestore()
})

describe("Home's body source testID (KTD5)", () => {
  it.each([
    ["experience", "home-body-live", "home-body-fallback"],
    ["config", "home-body-fallback", "home-body-live"],
  ] as const)(
    "the %s body shows %s and not %s",
    async (bodySource, shown, absent) => {
      setHome(bodySource)
      const renderer = render()

      const ids = hostTestIds(renderer)
      expect(ids).toContain(shown)
      expect(ids).not.toContain(absent)
      await unmount(renderer)
    },
  )

  it("puts the route's root testID on the content view", async () => {
    setHome("experience")
    const renderer = render()

    expect(hostTestIds(renderer)[0]).toBe("screen-tab-home")
    await unmount(renderer)
  })
})
