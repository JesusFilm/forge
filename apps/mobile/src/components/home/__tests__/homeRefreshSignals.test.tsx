/**
 * feat-517 U5: Home's two refresh signals, through the real `HomeScreen`.
 * The return-from-watch trigger is a route-segment transition (KTD5), so this
 * suite drives `useSegments` across rerenders; pull-to-refresh runs the body
 * refetch and the slate refresh together and keeps the row in the feed (AE13).
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests").
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
// The real feed gate runs against this env, so the row is admitted the way it
// is in production rather than through a stubbed predicate.
jest.mock("../../../env", () => ({
  env: {
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: "fleet-token",
    EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "http://localhost:3003/api/graphql",
  },
}))
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))
// The segments this suite steers. `useSegments` identity churns per render in
// production, so the mock returns a fresh array every call too.
jest.mock("expo-router", () => {
  const state: { segments: string[] } = { segments: ["(tabs)", "index"] }
  return {
    useRouter: () => ({
      push: jest.fn(),
      navigate: jest.fn(),
      back: jest.fn(),
    }),
    // `isFocused` seeds Home's focus flag; this suite runs focused.
    useNavigation: () => ({
      addListener: () => () => {},
      isFocused: () => true,
    }),
    useSegments: () => [...state.segments],
    __segments: state,
  }
})
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// Keeps the props Home hands it, so the suite can fire the refresh control the
// way a pull gesture would.
jest.mock("@shopify/flash-list", () => {
  const reactModule = jest.requireActual("react")
  const { View } = jest.requireActual("react-native")
  const seen: { props: Record<string, unknown> | null } = { props: null }
  return {
    __flashList: seen,
    FlashList: (props: {
      data: readonly unknown[]
      renderItem: (info: { item: unknown; index: number }) => unknown
    }) => {
      seen.props = props as unknown as Record<string, unknown>
      return reactModule.createElement(
        View,
        null,
        props.data.map((item, index) =>
          reactModule.createElement(
            reactModule.Fragment,
            { key: index },
            props.renderItem({ item, index }),
          ),
        ),
      )
    },
  }
})
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../HomeHeroPager", () => ({
  HERO_CHROME_BOTTOM: 0,
  HERO_CTA_HEIGHT: 0,
  HomeHeroPager: () => null,
}))
// Markers, not stubs: the feed's contents are read off them.
jest.mock("../HomeShelf", () => {
  const reactModule = jest.requireActual("react")
  const { Text } = jest.requireActual("react-native")
  return {
    HomeShelf: ({ section }: { section: { id: string } }) =>
      reactModule.createElement(Text, null, `section:${section.id}`),
  }
})
jest.mock("../RecommendationsShelf", () => {
  const reactModule = jest.requireActual("react")
  const { Text } = jest.requireActual("react-native")
  return {
    RecommendationsShelf: () =>
      reactModule.createElement(Text, null, "recommendations"),
  }
})
jest.mock("../HomeMissionSection", () => {
  const reactModule = jest.requireActual("react")
  const { Text } = jest.requireActual("react-native")
  return {
    HomeMissionSection: () => reactModule.createElement(Text, null, "mission"),
  }
})
jest.mock("../HomeHeroSelectorRail", () => ({
  HomeHeroSelectorRail: () => null,
}))
jest.mock("../../ui/HomeHeader", () => ({ HomeHeader: () => null }))
jest.mock("../HomeLogo", () => ({ HomeLogo: () => null }))
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
jest.mock("../../../hooks/useHomeRecommendations", () => ({
  useHomeRecommendations: jest.fn(),
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("../../../lib/splash/splashSession", () => ({
  getSplashSession: () => ({
    reportHomeContent: jest.fn(),
    retractHomeContent: jest.fn(),
    reportHomeFailure: jest.fn(),
    retractHomeFailure: jest.fn(),
  }),
}))

import { act, createElement } from "react"

import { HomeScreen } from "../HomeScreen"
import { useHomeRecommendations } from "../../../hooks/useHomeRecommendations"
import { useWatchHome } from "../../../hooks/useWatchHome"
import type {
  WatchHomeModel,
  WatchHomeSection,
} from "../../../lib/watchHome/model"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const { __segments: segmentState } = jest.requireMock("expo-router") as {
  __segments: { segments: string[] }
}
const { __flashList: flashList } = jest.requireMock("@shopify/flash-list") as {
  __flashList: { props: Record<string, unknown> | null }
}
const mockUseWatchHome = useWatchHome as unknown as jest.Mock
const mockController = useHomeRecommendations as unknown as jest.Mock

const HOME: string[] = ["(tabs)", "index"]

function section(id: string): WatchHomeSection {
  return {
    id,
    eyebrow: "",
    title: id,
    description: null,
    layout: "rail",
    orientation: "horizontal",
    showSequenceNumbers: false,
    cards: [],
  }
}

function model(): WatchHomeModel {
  return {
    sections: [section("a"), section("b")],
    carousel: { pools: [], muxInserts: [] },
    missingData: [],
  }
}

const refresh = jest.fn()
const refetch = jest.fn()

function controller() {
  return {
    status: "served",
    slate: null,
    reportShelfMounted: jest.fn(),
    reportShelfVisible: jest.fn(),
    reportVisibleCards: jest.fn(),
    reportShelfDetached: jest.fn(),
    recordRender: jest.fn(),
    select: jest.fn(async () => null),
    refresh,
  }
}

const mounted: TestInstance[] = []

function renderHome(options: { refreshing?: boolean } = {}) {
  mockUseWatchHome.mockReturnValue({
    model: model(),
    recommendationsInsertIndex: 1,
    loading: false,
    refreshing: options.refreshing ?? false,
    error: null,
    refetch,
  })
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(createElement(HomeScreen))
  })
  mounted.push(renderer)
  return {
    renderer,
    /** Move the router to `next`, then let Home re-render on it. */
    goTo: (next: string[]) => {
      segmentState.segments = next
      act(() => {
        renderer.update(createElement(HomeScreen))
      })
    },
    setRefreshing: (refreshing: boolean) => {
      mockUseWatchHome.mockReturnValue({
        model: model(),
        recommendationsInsertIndex: 1,
        loading: false,
        refreshing,
        error: null,
        refetch,
      })
      act(() => {
        renderer.update(createElement(HomeScreen))
      })
    },
  }
}

/** The feed's own contents, read off the marker text each item renders. */
function feedMarkers(renderer: TestInstance): string[] {
  return renderer.root
    .findAll(
      (node: RenderedNode) =>
        typeof node.type === "string" &&
        typeof node.props.children === "string",
    )
    .map((node) => node.props.children as string)
}

function firePullToRefresh(): void {
  const control = flashList.props?.refreshControl as {
    props: { onRefresh: () => void }
  }
  act(() => control.props.onRefresh())
}

beforeEach(() => {
  segmentState.segments = [...HOME]
  mockController.mockImplementation(() => controller())
})

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.clearAllMocks()
})

describe("the return-from-watch trigger (AE7, KTD5)", () => {
  it("refreshes once, on the transition back to Home", () => {
    const home = renderHome()
    expect(refresh).not.toHaveBeenCalled()

    home.goTo(["watch", "[slug]"])
    expect(refresh).not.toHaveBeenCalled()

    home.goTo([...HOME])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("refreshes nothing when the viewer only visits the Discover tab", () => {
    const home = renderHome()

    home.goTo(["(tabs)", "watch"])
    home.goTo([...HOME])
    expect(refresh).not.toHaveBeenCalled()
  })

  it("refreshes once for a series to watch to Home chain", () => {
    const home = renderHome()

    home.goTo(["series", "[slug]"])
    home.goTo(["watch", "[slug]"])
    expect(refresh).not.toHaveBeenCalled()

    home.goTo(["(tabs)"])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("refreshes nothing when Home first renders under a watch route", () => {
    // A deep link opens the watch route over the tabs, so Home's first render
    // can happen there. Its own mount fetch covers the slate; the focus axis
    // of that launch is pinned in RecommendationsShelf.test.tsx.
    segmentState.segments = ["watch", "[slug]"]
    const home = renderHome()
    expect(refresh).not.toHaveBeenCalled()

    home.goTo([...HOME])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("refreshes nothing on a re-render that does not move the route", () => {
    const home = renderHome()

    home.goTo([...HOME])
    home.setRefreshing(false)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("pull-to-refresh (AE13)", () => {
  it("refetches the body and the slate together", () => {
    renderHome()

    firePullToRefresh()
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("keeps the row in the feed while the body loads (R18)", () => {
    const home = renderHome()
    expect(feedMarkers(home.renderer)).toContain("recommendations")

    firePullToRefresh()
    home.setRefreshing(true)
    expect(feedMarkers(home.renderer)).toContain("recommendations")
  })
})
