/**
 * Home's only report into the splash session (U5, R3/R15).
 *
 * The splash draws ABOVE this screen and needs to know when it may hand over.
 * Nothing here waits on the splash, so the whole contract is: report the first
 * model, report a failure that leaves nothing to paint, and never report twice.
 *
 * Every branch this suite renders is one of Home's three simple states, so the
 * feed's own children stay mocked out.
 */

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("@shopify/flash-list", () => ({ FlashList: () => null }))
jest.mock("expo-image", () => {
  const Image = () => null
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
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
jest.mock("../../../lib/splash/splashSession", () => {
  const session = {
    reportHomeContent: jest.fn(),
    reportHomeFailure: jest.fn(),
  }
  return { getSplashSession: () => session, __session: session }
})

import { act, createElement } from "react"

import { HomeScreen } from "../HomeScreen"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import type { WatchHomeModel } from "../../../lib/watchHome/model"

const { useWatchHome } = jest.requireMock("../../../hooks/useWatchHome") as {
  useWatchHome: jest.Mock
}
const { __session: splash } = jest.requireMock(
  "../../../lib/splash/splashSession",
) as {
  __session: { reportHomeContent: jest.Mock; reportHomeFailure: jest.Mock }
}

/** A model with nothing renderable — Home's "No content available" branch. */
function emptyModel(): WatchHomeModel {
  return {
    sections: [],
    carousel: { pools: [], muxInserts: [] },
  } as unknown as WatchHomeModel
}

type HookState = {
  model: WatchHomeModel | null
  loading?: boolean
  refreshing?: boolean
  error?: string | null
}

function setHookState(state: HookState) {
  useWatchHome.mockReturnValue({
    model: state.model,
    loading: state.loading ?? false,
    refreshing: state.refreshing ?? false,
    error: state.error ?? null,
    refetch: jest.fn(),
  })
}

function render(): TestInstance {
  let renderer: TestInstance | undefined
  act(() => {
    renderer = TestRenderer.create(createElement(HomeScreen))
  })
  if (!renderer) throw new Error("render failed")
  return renderer
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("Home's handover report to the splash", () => {
  it("reports content the first time a model lands, and not again", () => {
    setHookState({ model: null, loading: true })
    const renderer = render()
    expect(splash.reportHomeContent).not.toHaveBeenCalled()

    setHookState({ model: emptyModel() })
    act(() => renderer.update(createElement(HomeScreen)))
    expect(splash.reportHomeContent).toHaveBeenCalledTimes(1)

    // A later refetch produces a new model identity. The cover is long gone by
    // then, and a second report would be a lie about a first paint.
    setHookState({ model: emptyModel() })
    act(() => renderer.update(createElement(HomeScreen)))
    expect(splash.reportHomeContent).toHaveBeenCalledTimes(1)

    expect(splash.reportHomeFailure).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it("reports the failure when the fetch leaves nothing to paint", () => {
    setHookState({ model: null, loading: true })
    const renderer = render()

    setHookState({ model: null, error: "network" })
    act(() => renderer.update(createElement(HomeScreen)))
    // R15: the retry card is reachable as soon as there is something to retry,
    // rather than the cover holding to the 6 second ceiling.
    expect(splash.reportHomeFailure).toHaveBeenCalledTimes(1)
    expect(splash.reportHomeContent).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it("prefers the model when both arrive in the same render", () => {
    // Both set BEFORE the first render, so the one-shot latch is still open
    // and the effect has to choose. Reporting the model first is the whole
    // property; a sequential render latches before `error` is ever seen and
    // would pass whichever branch came first.
    setHookState({ model: emptyModel(), error: "network" })
    const renderer = render()

    expect(splash.reportHomeContent).toHaveBeenCalledTimes(1)
    expect(splash.reportHomeFailure).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it("does not drop the cover when a refetch fails over live content", () => {
    setHookState({ model: emptyModel() })
    const renderer = render()
    expect(splash.reportHomeContent).toHaveBeenCalledTimes(1)

    setHookState({ model: emptyModel(), error: "network" })
    act(() => renderer.update(createElement(HomeScreen)))
    expect(splash.reportHomeFailure).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })
})
