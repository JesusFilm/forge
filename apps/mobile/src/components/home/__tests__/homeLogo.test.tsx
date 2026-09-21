/**
 * Home's JFP logo sits on its own layer. A downward scroll only triggers it;
 * the logo then slides off the top on its own animation.
 */

// feat-517: HomeScreen now hosts the recommendations controller, which reads
// the watch-preferences provider; that module pulls AsyncStorage in.
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
    recordRender: jest.fn(),
    recordImpression: jest.fn(),
    select: jest.fn(async () => null),
    refresh: jest.fn(),
  }),
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// Renders nothing, and keeps the props so the suite can drive onScroll.
jest.mock("@shopify/flash-list", () => {
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  return {
    FlashList: (props: MockFlashListProps) => {
      mockFlashListProps.current = props
      return createElement("MockFlashList")
    },
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
  useNavigation: () => ({ addListener: () => () => {} }),
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
  useReduceMotion: jest.fn(() => false),
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
  buildWatchHomeHeroQueue: jest.fn(),
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

import { act, createElement, type ReactElement } from "react"
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  useWindowDimensions,
} from "react-native"

import { HomeLogo } from "../HomeLogo"
import { HomeScreen } from "../HomeScreen"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import type { WatchHomeModel } from "../../../lib/watchHome/model"

type MockFlashListProps = {
  ListHeaderComponent?: unknown
  contentContainerStyle?: Record<string, unknown>
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
}
const mockFlashListProps: { current: MockFlashListProps | null } = {
  current: null,
}

const { useWatchHome } = jest.requireMock("../../../hooks/useWatchHome") as {
  useWatchHome: jest.Mock
}
const { buildWatchHomeHeroQueue } = jest.requireMock(
  "../../../lib/watchHome/carouselSequence",
) as { buildWatchHomeHeroQueue: jest.Mock }
const { useReduceMotion } = jest.requireMock(
  "../../../hooks/useReduceMotion",
) as { useReduceMotion: jest.Mock }

const HERO_SLIDE = { kind: "video", id: "v1", slug: "jesus", title: "JESUS" }
// 62 inset + 4 row gap + (40 row - 26 logo) / 2.
const LOGO_TOP = 73
// The logo's top + its 26pt height + 8pt of extra travel.
const EXIT_OFFSET = -107

function setHome() {
  buildWatchHomeHeroQueue.mockReturnValue({
    slides: [HERO_SLIDE],
    wrapped: false,
    videos: [],
  })
  useWatchHome.mockReturnValue({
    model: {
      sections: [],
      carousel: { pools: [], muxInserts: [] },
    } as unknown as WatchHomeModel,
    loading: false,
    refreshing: false,
    error: null,
    refetch: jest.fn(),
  })
}

function render(element: ReactElement): TestInstance {
  let renderer: TestInstance | undefined
  act(() => {
    renderer = TestRenderer.create(element)
  })
  if (!renderer) throw new Error("render failed")
  return renderer
}

function hostNode(renderer: TestInstance, testID: string): RenderedNode {
  const [node] = renderer.root.findAll(
    (n) => typeof n.type === "string" && n.props.testID === testID,
  )
  if (!node) throw new Error(`no host node ${testID}`)
  return node
}

function scrollTo(y: number) {
  const onScroll = mockFlashListProps.current?.onScroll
  if (!onScroll) throw new Error("FlashList has no onScroll")
  act(() => {
    onScroll({
      nativeEvent: { contentOffset: { x: 0, y } },
    } as NativeSyntheticEvent<NativeScrollEvent>)
  })
}

function windowWidth(): number {
  let width = 0
  function Probe() {
    width = useWindowDimensions().width
    return null
  }
  render(createElement(Probe))
  return width
}

let timing: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  mockFlashListProps.current = null
  useReduceMotion.mockReturnValue(false)
  timing = jest.spyOn(Animated, "timing").mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
    reset: jest.fn(),
  } as unknown as Animated.CompositeAnimation)
})

afterEach(() => {
  timing.mockRestore()
})

describe("Home's JFP logo layer", () => {
  it("renders once, beside the feed and not inside it, and leaves the feed's layout alone", () => {
    setHome()
    const renderer = render(createElement(HomeScreen))

    const logos = renderer.root.findAll(
      (n) => typeof n.type === "string" && n.props.testID === "home-logo",
    )
    expect(logos).toHaveLength(1)
    expect(mockFlashListProps.current?.ListHeaderComponent).toBeUndefined()
    expect(mockFlashListProps.current?.contentContainerStyle).toMatchObject({
      paddingTop: Math.round(windowWidth() * 1.2),
    })
  })

  it("sits in the top-left corner on HomeHeader's row, above HomeHeader", () => {
    setHome()
    const renderer = render(createElement(HomeScreen))

    const layer = hostNode(renderer, "home-logo-layer")
    expect(StyleSheet.flatten(layer.props.style)).toMatchObject({
      position: "absolute",
      left: 16,
      top: LOGO_TOP,
      zIndex: 11,
    })
    expect(layer.props.pointerEvents).toBe("none")
    const logo = hostNode(renderer, "home-logo")
    expect(StyleSheet.flatten(logo.props.style)).toMatchObject({
      width: 36,
      height: 26,
    })
    expect(logo.props.accessibilityLabel).toBe("Jesus Film Project")
  })

  it("hides after a downward scroll, and returns only at the top", () => {
    setHome()
    const renderer = render(createElement(HomeScreen))
    const hidden = () =>
      hostNode(renderer, "home-logo-layer").props.accessibilityElementsHidden

    expect(hidden()).toBe(false)
    scrollTo(50)
    expect(hidden()).toBe(true)
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: EXIT_OFFSET }),
    )
    scrollTo(5)
    expect(hidden()).toBe(true)
    scrollTo(0)
    expect(hidden()).toBe(false)
    expect(timing).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 0 }),
    )
  })
})

describe("HomeLogo's own animation", () => {
  it("does not animate on mount, in either state", () => {
    render(createElement(HomeLogo, { topInset: 62, hidden: false }))
    render(createElement(HomeLogo, { topInset: 62, hidden: true }))
    expect(timing).not.toHaveBeenCalled()
  })

  it("slides out fast and accelerating, and back slower and decelerating, on the native driver", () => {
    const renderer = render(
      createElement(HomeLogo, { topInset: 62, hidden: false }),
    )

    act(() =>
      renderer.update(createElement(HomeLogo, { topInset: 62, hidden: true })),
    )
    expect(timing).toHaveBeenCalledTimes(1)
    const exit = timing.mock.calls[0][1]
    expect(exit).toMatchObject({
      toValue: EXIT_OFFSET,
      duration: 220,
      useNativeDriver: true,
    })

    act(() =>
      renderer.update(createElement(HomeLogo, { topInset: 62, hidden: false })),
    )
    expect(timing).toHaveBeenCalledTimes(2)
    const enter = timing.mock.calls[1][1]
    expect(enter).toMatchObject({
      toValue: 0,
      duration: 280,
      useNativeDriver: true,
    })
    // Ease-in starts slow and ends fast; ease-out does the opposite.
    expect(exit.easing(0.5)).toBeLessThan(0.5)
    expect(enter.easing(0.5)).toBeGreaterThan(0.5)
  })

  it("drops the slide under Reduce Motion, but still leaves and returns", () => {
    useReduceMotion.mockReturnValue(true)
    const renderer = render(
      createElement(HomeLogo, { topInset: 62, hidden: false }),
    )

    act(() =>
      renderer.update(createElement(HomeLogo, { topInset: 62, hidden: true })),
    )
    act(() =>
      renderer.update(createElement(HomeLogo, { topInset: 62, hidden: false })),
    )
    expect(timing.mock.calls.map(([, config]) => config)).toEqual([
      expect.objectContaining({ toValue: EXIT_OFFSET, duration: 0 }),
      expect.objectContaining({ toValue: 0, duration: 0 }),
    ])
  })
})
