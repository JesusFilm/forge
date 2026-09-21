/**
 * feat-517: the Recommended for You row. Six landscape cards in served order,
 * one render fact per item once Home is focused, a placeholder that holds the
 * row's height until a terminal outcome leaves the viewport, and a tap that
 * opens the video in the same tick as the selection call (KTD6, KTD8).
 *
 * The last block renders the row through the real `HomeScreen` feed, with the
 * controller mocked at its module boundary only.
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
// The real gate functions run against this env, so both client-side axes are
// exercised rather than stubbed.
jest.mock("../../../env", () => ({
  env: {
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: "fleet-token",
    EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "http://localhost:3003/api/graphql",
  },
}))
jest.mock("expo-image", () => {
  const Image = () => null
  Image.prefetch = () => Promise.resolve(true)
  return { __esModule: true, Image }
})
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))
jest.mock("expo-router", () => {
  const router = { push: jest.fn(), navigate: jest.fn(), back: jest.fn() }
  // Home's focus flag comes from these listeners, and the integration block
  // fires them to pin that the flag reaches the controller and the row.
  const listeners: Record<string, (() => void)[]> = {}
  const navigation = {
    addListener: (event: string, fn: () => void) => {
      listeners[event] = [...(listeners[event] ?? []), fn]
      return () => {}
    },
  }
  return {
    useRouter: () => router,
    useNavigation: () => navigation,
    __router: router,
    __fireNavigation: (event: string) =>
      (listeners[event] ?? []).forEach((fn) => fn()),
  }
})
jest.mock("../../watch/WatchProgressBar", () => ({
  WatchProgressBar: () => null,
  progressAccessibilityText: () => null,
}))
jest.mock("../../../hooks/useWatchProgressEntry", () => ({
  useWatchProgressEntry: () => null,
}))
jest.mock("../../../hooks/useHeroStream", () => ({
  prefetchHeroStream: jest.fn(),
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
// ── HomeScreen's own tree, for the integration block ────────────────────────
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("@shopify/flash-list", () => {
  const reactModule = jest.requireActual("react")
  const { View } = jest.requireActual("react-native")
  return {
    FlashList: ({
      data,
      renderItem,
    }: {
      data: readonly unknown[]
      renderItem: (info: { item: unknown; index: number }) => unknown
    }) =>
      reactModule.createElement(
        View,
        null,
        data.map((item, index) =>
          reactModule.createElement(
            reactModule.Fragment,
            { key: index },
            renderItem({ item, index }),
          ),
        ),
      ),
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
// Markers, not stubs: the integration block reads the feed's ORDER off them.
jest.mock("../HomeShelf", () => {
  const reactModule = jest.requireActual("react")
  const { Text } = jest.requireActual("react-native")
  return {
    HomeShelf: ({ section }: { section: { id: string } }) =>
      reactModule.createElement(Text, null, `section:${section.id}`),
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
jest.mock("../../../lib/splash/splashSession", () => ({
  getSplashSession: () => ({
    reportHomeContent: jest.fn(),
    retractHomeContent: jest.fn(),
    reportHomeFailure: jest.fn(),
    retractHomeFailure: jest.fn(),
  }),
}))

import { act, createElement } from "react"
import { Dimensions } from "react-native"

import { HomeScreen } from "../HomeScreen"
import {
  RecommendationsShelf,
  RECOMMENDATIONS_SHELF_TITLE,
  recommendationsShelfBodyHeight,
  type RecommendationsShelfProps,
} from "../RecommendationsShelf"
import { homeCardWidth } from "../HomeCard"
import { computeTypographyScale } from "../../../hooks/useTypography"
import { useHomeRecommendations } from "../../../hooks/useHomeRecommendations"
import { useWatchHome } from "../../../hooks/useWatchHome"
import type {
  UserRecommendationItem,
  UserRecommendationSlate,
} from "../../../lib/recommendations/delivery"
import { decodeWatchSeed } from "../../../lib/watchSeed"
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

const { __router: router, __fireNavigation: fireNavigation } = jest.requireMock(
  "expo-router",
) as {
  __router: { push: jest.Mock; navigate: jest.Mock; back: jest.Mock }
  __fireNavigation: (event: string) => void
}
const mockUseWatchHome = useWatchHome as unknown as jest.Mock
const mockController = useHomeRecommendations as unknown as jest.Mock

// ── Fixtures ────────────────────────────────────────────────────────────────

function item(index: number): UserRecommendationItem {
  return {
    id: `item-${index}`,
    position: index,
    targetMediaId: `media-${index}`,
    canonicalHref: `https://www.jesusfilm.org/watch/video-${index}.html`,
    capability: `cap-${index}`,
    videoSlug: `video-${index}`,
    videoTitle: `Video ${index}`,
    imageUrl: `https://cdn.example.org/video-${index}.jpg`,
    description: "",
    durationSeconds: 120,
    generator: "curated",
    poolVersion: null,
    poolKey: null,
  }
}

function slate(
  overrides: Partial<UserRecommendationSlate> = {},
): UserRecommendationSlate {
  return {
    requestId: "req-1",
    expiresAt: null,
    cohort: "cold_start",
    profileCount: 0,
    curatedCount: 6,
    poolVersion: null,
    items: Array.from({ length: 6 }, (_, index) => item(index)),
    ...overrides,
  }
}

const SCREEN_WIDTH = Dimensions.get("window").width

// ── Render helpers ──────────────────────────────────────────────────────────

const mounted: TestInstance[] = []

function baseProps(): RecommendationsShelfProps {
  return {
    status: "served",
    slate: slate(),
    focused: true,
    inView: true,
    onShelfMount: jest.fn(),
    onRecordRender: jest.fn(),
    onSelect: jest.fn(async () => null),
    onRefresh: jest.fn(),
  }
}

function renderShelf(overrides: Partial<RecommendationsShelfProps> = {}) {
  let props = { ...baseProps(), ...overrides }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      createElement(RecommendationsShelf, props) as never,
    )
  })
  mounted.push(renderer)
  return {
    renderer,
    props,
    update(next: Partial<RecommendationsShelfProps> = {}) {
      props = { ...props, ...next }
      act(() => {
        renderer.update(createElement(RecommendationsShelf, props) as never)
      })
    },
  }
}

/** One entry per rendered card title, in render order. */
function cardTitles(renderer: TestInstance): string[] {
  return renderer.root
    .findAll(
      (node: RenderedNode) =>
        typeof node.type === "string" &&
        node.props.numberOfLines === 2 &&
        typeof node.props.children === "string",
    )
    .map((node) => node.props.children as string)
}

/**
 * The card whose accessible name is `title`. Pressable keeps `onPress` on the
 * composite node — the host View it renders converts it into responder
 * handlers — so this deliberately does not filter on a host type.
 */
function cardPressable(renderer: TestInstance, title: string): RenderedNode {
  const [node] = renderer.root.findAll(
    (candidate: RenderedNode) =>
      candidate.props.accessibilityLabel === title &&
      typeof candidate.props.onPress === "function",
  )
  expect(node).toBeDefined()
  return node!
}

function pressCard(renderer: TestInstance, title: string): void {
  act(() => {
    cardPressable(renderer, title).props.onPress!()
  })
}

/** The handler identity each card is handed — the card-memo stability seam. */
function pressOverrides(renderer: TestInstance): unknown[] {
  return renderer.root
    .findAll(
      (node: RenderedNode) => typeof node.props.onPressOverride === "function",
    )
    .map((node) => node.props.onPressOverride)
}

/** Reference equality, element by element — `toEqual` is too forgiving here. */
function expectSameIdentities(after: unknown[], before: unknown[]): void {
  expect(after.length).toBe(before.length)
  after.forEach((entry, index) => expect(entry).toBe(before[index]))
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.clearAllMocks()
})

// ── The served row ──────────────────────────────────────────────────────────

describe("a served slate", () => {
  it("renders six landscape cards in position order and records each once (AE2)", () => {
    const { renderer, props } = renderShelf()
    expect(cardTitles(renderer)).toEqual([
      "Video 0",
      "Video 1",
      "Video 2",
      "Video 3",
      "Video 4",
      "Video 5",
    ])
    expect(props.onRecordRender).toHaveBeenCalledTimes(6)
    expect(
      (props.onRecordRender as jest.Mock).mock.calls.map(([id]) => id),
    ).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4", "item-5"])
  })

  it("sizes its cards with the landscape variant", () => {
    const { renderer } = renderShelf()
    const [first] = renderer.root.findAll(
      (node: RenderedNode) => typeof node.props.style === "function",
    )
    const style = Object.assign(
      {},
      ...(first!.props.style as (s: { pressed: boolean }) => unknown[])({
        pressed: false,
      }).filter(Boolean),
    ) as { width: number; aspectRatio: number }
    expect(style.width).toBe(homeCardWidth("landscape", SCREEN_WIDTH))
    expect(style.aspectRatio).toBe(16 / 9)
  })

  it("draws the shelf's own title, not an authored one (R4)", () => {
    const { renderer } = renderShelf()
    const headings = renderer.root.findAll(
      (node: RenderedNode) => node.props.accessibilityRole === "header",
    )
    expect(headings.length).toBeGreaterThan(0)
    expect(headings[0]!.props.children).toBe(RECOMMENDATIONS_SHELF_TITLE)
  })

  it("reports its first mount exactly once (R7)", () => {
    const { props, update } = renderShelf()
    expect(props.onShelfMount).toHaveBeenCalledTimes(1)
    update({ slate: slate({ requestId: "req-2" }) })
    expect(props.onShelfMount).toHaveBeenCalledTimes(1)
  })

  it("renders the served order even when the items arrive shuffled", () => {
    // SYNTHETIC fixture: `validateServedSlate` rejects any slate whose item
    // positions are not their own index, so this order cannot reach the row
    // today. It pins the sort, which is the row's own second check of R5.
    const shuffled = slate({
      items: [item(2), item(0), item(1), item(5), item(3), item(4)],
    })
    const { renderer } = renderShelf({ slate: shuffled })
    expect(cardTitles(renderer)).toEqual([
      "Video 0",
      "Video 1",
      "Video 2",
      "Video 3",
      "Video 4",
      "Video 5",
    ])
  })
})

// ── Render facts and focus ──────────────────────────────────────────────────

describe("render facts", () => {
  it("waits for focus, then records each item once (KTD3)", () => {
    const { props, update } = renderShelf({ focused: false })
    expect(props.onRecordRender).not.toHaveBeenCalled()

    update({ focused: true })
    expect(props.onRecordRender).toHaveBeenCalledTimes(6)
  })

  it("records again for a new slate", () => {
    const { props, update } = renderShelf()
    expect(props.onRecordRender).toHaveBeenCalledTimes(6)

    update({ slate: slate({ requestId: "req-2" }) })
    expect(props.onRecordRender).toHaveBeenCalledTimes(12)
  })

  it("records once per slate even when the callback identity changes (R11)", () => {
    const first = jest.fn()
    const { update } = renderShelf({ onRecordRender: first })
    expect(first).toHaveBeenCalledTimes(6)

    // The controller re-creates `recordRender` whenever the inner hook's slate
    // reference changes, and that happens at the start of every refetch while
    // this row still displays the last served slate. Without the per-slate
    // latch the same six facts would be sent again.
    const second = jest.fn()
    update({ status: "loading", onRecordRender: second })
    expect(second).not.toHaveBeenCalled()
  })
})

// ── Non-served outcomes ─────────────────────────────────────────────────────

describe("a non-served outcome", () => {
  it.each([
    ["unavailable" as const],
    ["disabled" as const],
    ["unprovisioned" as const],
  ])("renders no cards on %s (AE3, AE4)", (status) => {
    const { renderer } = renderShelf({ status, slate: null })
    expect(cardTitles(renderer)).toEqual([])
  })

  it("renders no cards for a slate of the wrong length (AE3)", () => {
    // SYNTHETIC fixture: `validateServedSlate` turns a five-item answer into
    // `invalid_delivery`, so the row never sees one. This pins the row's own
    // re-check of that single upstream predicate.
    const short = slate({
      items: [item(0), item(1), item(2), item(3), item(4)],
    })
    const { renderer } = renderShelf({ slate: short })
    expect(cardTitles(renderer)).toEqual([])
  })

  it("holds the row's height while it loads, then collapses out of view (R8, AE4)", () => {
    const { renderer, update } = renderShelf({
      status: "loading",
      slate: null,
    })
    const expected = recommendationsShelfBodyHeight(
      SCREEN_WIDTH,
      computeTypographyScale(SCREEN_WIDTH).titleSmall.lineHeight,
    )
    const spacer = renderer.root.findAll(
      (node: RenderedNode) =>
        typeof node.type === "string" &&
        (node.props.style as { height?: number } | undefined)?.height ===
          expected,
    )
    expect(spacer.length).toBeGreaterThan(0)

    // A terminal outcome keeps the placeholder while the row is on screen:
    // collapsing under the viewer's eyes is the layout jump R8 forbids.
    update({ status: "unavailable" })
    expect(renderer.toJSON()).not.toBeNull()

    update({ inView: false })
    expect(renderer.toJSON()).toBeNull()
  })

  it("keeps the placeholder while a slate is still loading out of view", () => {
    const { renderer } = renderShelf({
      status: "loading",
      slate: null,
      inView: false,
    })
    expect(renderer.toJSON()).not.toBeNull()
  })

  it("keeps the current cards on screen during a refetch (R18)", () => {
    const { renderer, update } = renderShelf()
    update({ status: "loading" })
    expect(cardTitles(renderer)).toHaveLength(6)
  })
})

// ── The card press ──────────────────────────────────────────────────────────

describe("a card press", () => {
  it("carries its own RUM action name (KTD8)", () => {
    const { renderer } = renderShelf()
    expect(cardPressable(renderer, "Video 0").props["dd-action-name"]).toBe(
      "recommendation-card",
    )
  })

  it("selects and navigates in one synchronous call (KTD6, R13)", () => {
    const { renderer, props } = renderShelf()
    pressCard(renderer, "Video 2")
    expect(props.onSelect).toHaveBeenCalledTimes(1)
    expect(props.onSelect).toHaveBeenCalledWith("item-2")
    expect(router.navigate).toHaveBeenCalledTimes(1)
    expect(router.push).not.toHaveBeenCalled()

    const [href] = router.navigate.mock.calls[0]! as [string]
    expect(href.startsWith("/watch/video-2?seed=")).toBe(true)
    const seed = decodeWatchSeed(href.slice(href.indexOf("seed=") + 5))
    expect(seed).toEqual({
      slug: "video-2",
      title: "Video 2",
      imageUrl: "https://cdn.example.org/video-2.jpg",
      playbackId: null,
    })
  })

  it("navigates again on a second tap during an in-flight selection (AE15)", () => {
    const { renderer } = renderShelf()
    pressCard(renderer, "Video 0")
    pressCard(renderer, "Video 0")
    // `navigate` is what keeps the pair to one screen; `push` would stack two.
    expect(router.navigate).toHaveBeenCalledTimes(2)
    expect(router.push).not.toHaveBeenCalled()
  })

  it("opens the video and refreshes, without selecting, past expiry (AE6)", () => {
    const expired = slate({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const { renderer, props } = renderShelf({ slate: expired })
    pressCard(renderer, "Video 1")
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    expect(router.navigate).toHaveBeenCalledTimes(1)
  })

  it("opens the video and does not refresh when select resolves null (AE14)", async () => {
    const onSelect = jest.fn(async () => null)
    const { renderer, props } = renderShelf({ onSelect })
    pressCard(renderer, "Video 3")
    await act(async () => {})
    expect(onSelect).toHaveBeenCalledWith("item-3")
    expect(props.onRefresh).not.toHaveBeenCalled()
    expect(router.navigate).toHaveBeenCalledTimes(1)
  })
})

// ── Card memo stability ─────────────────────────────────────────────────────

describe("card props", () => {
  it("bail the row out when Home hands it the same props again", () => {
    const { renderer, update } = renderShelf()
    const before = pressOverrides(renderer)
    expect(before.length).toBeGreaterThan(0)

    // Home's `extraData` re-invokes `renderItem` on every hero advance, so the
    // row is handed the same props again and its own memo must absorb it.
    update({})
    expectSameIdentities(pressOverrides(renderer), before)
  })

  it("keep their identity when the row re-renders for another reason", () => {
    const { renderer, update } = renderShelf()
    const before = pressOverrides(renderer)

    // A refetch changes `status` while this row still displays the last served
    // slate, so the row DOES re-render. Rebuilding the handlers there would
    // re-render all six cards for a slate that has not changed.
    update({ status: "loading" })
    expectSameIdentities(pressOverrides(renderer), before)
  })

  it("change when a new slate arrives", () => {
    const { renderer, update } = renderShelf()
    const before = pressOverrides(renderer)
    update({ slate: slate({ requestId: "req-2" }) })
    const after = pressOverrides(renderer)
    expect(after.length).toBe(before.length)
    expect(after.some((fn, index) => fn !== before[index])).toBe(true)
  })
})

// ── Through Home's own feed ─────────────────────────────────────────────────

describe("rendered from Home's feed", () => {
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

  function controller(overrides: Record<string, unknown> = {}) {
    return {
      status: "served",
      slate: slate(),
      reportShelfMounted: jest.fn(),
      recordRender: jest.fn(),
      recordImpression: jest.fn(),
      select: jest.fn(async () => null),
      refresh: jest.fn(),
      ...overrides,
    }
  }

  function renderHome(insertIndex: number | null) {
    mockUseWatchHome.mockReturnValue({
      model: model(),
      recommendationsInsertIndex: insertIndex,
      loading: false,
      refreshing: false,
      error: null,
      refetch: jest.fn(),
    })
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(createElement(HomeScreen))
    })
    mounted.push(renderer)
    return renderer
  }

  /** The feed's own order, read off the marker text each item renders. */
  function feedOrder(renderer: TestInstance): string[] {
    return renderer.root
      .findAll(
        (node: RenderedNode) =>
          typeof node.type === "string" &&
          typeof node.props.children === "string" &&
          (node.props.children.startsWith("section:") ||
            node.props.children === "mission" ||
            node.props.children === RECOMMENDATIONS_SHELF_TITLE),
      )
      .map((node) => node.props.children as string)
  }

  it("draws the row at the authored position with six cards (R1)", () => {
    const state = controller()
    mockController.mockReturnValue(state)
    const renderer = renderHome(1)

    expect(feedOrder(renderer)).toEqual([
      "section:a",
      RECOMMENDATIONS_SHELF_TITLE,
      "section:b",
      "mission",
    ])
    expect(cardTitles(renderer)).toHaveLength(6)
    expect(state.reportShelfMounted).toHaveBeenCalledTimes(1)
    expect(mockController).toHaveBeenCalledWith(
      expect.objectContaining({ gateOpen: true, focused: true }),
    )
  })

  it("hands Home's focus flag to the controller (KTD3)", () => {
    mockController.mockReturnValue(controller())
    renderHome(1)
    expect(mockController).toHaveBeenLastCalledWith(
      expect.objectContaining({ focused: true }),
    )

    act(() => fireNavigation("blur"))
    expect(mockController).toHaveBeenLastCalledWith(
      expect.objectContaining({ focused: false }),
    )

    act(() => fireNavigation("focus"))
    expect(mockController).toHaveBeenLastCalledWith(
      expect.objectContaining({ focused: true }),
    )
  })

  it("draws no row and opens no gate when the block is absent (R1)", () => {
    mockController.mockReturnValue(controller())
    const renderer = renderHome(null)

    expect(feedOrder(renderer)).toEqual(["section:a", "section:b", "mission"])
    expect(cardTitles(renderer)).toEqual([])
    expect(mockController).toHaveBeenCalledWith(
      expect.objectContaining({ gateOpen: false }),
    )
  })
})
