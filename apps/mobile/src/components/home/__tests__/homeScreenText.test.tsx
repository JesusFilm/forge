/** U10: Home's own states and hero controls read the `Home` catalog, and each
 *  moved control keeps one tap name in both languages. Also the hero mute's
 *  glass (R8, AE6). The feed's children stay mocked out, as in
 *  homeSplashHandover.test.tsx. */

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
// Keeps the feed's scroll handler, so a case can scroll the hero chrome.
const mockFeed: { onScroll?: (e: unknown) => void } = {}
jest.mock("@shopify/flash-list", () => ({
  FlashList: (props: { onScroll?: (e: unknown) => void }) => {
    mockFeed.onScroll = props.onScroll
    return null
  },
}))
// The `mock` prefix lets babel-plugin-jest-hoist accept this name. A case
// takes the glass branch unless it turns the gate off.
const mockGlass = { on: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGlass.on,
}))
// A host stand-in, so a case can see where the glass draws.
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))
jest.mock("expo-image", () => ({ __esModule: true, Image: () => null }))
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))
const mockRouter = { push: () => {}, back: () => {}, navigate: () => {} }
const mockNavigation = { addListener: () => () => {}, isFocused: () => true }
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useNavigation: () => mockNavigation,
  useSegments: () => ["(tabs)", "index"],
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
    markVideoPlayed: () => {},
    resetPlayedIds: () => {},
    persistActiveSlide: () => {},
  }),
}))
jest.mock("../../../hooks/useWatchHome", () => ({ useWatchHome: jest.fn() }))
jest.mock("../../../lib/splash/splashSession", () => ({
  getSplashSession: () => ({
    reportHomeContent: () => {},
    retractHomeContent: () => {},
    reportHomeFailure: () => {},
    retractHomeFailure: () => {},
  }),
}))

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../i18n/catalogs.generated"),
      {
        es: {
          Home: {
            loadErrorTitle: "Algo salió mal",
            loadErrorMessage: "No se pudieron cargar los videos.",
            retry: "Reintentar",
            retryAriaLabel: "Reintentar la carga",
            watchNow: "Ver ahora",
            watchNowAriaLabel: "Ver {title} ahora",
            muteAriaLabel: "Silenciar el video",
          },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../i18n/pluralData.generated"),
      ["es"],
    ),
)

import { act, createElement } from "react"
import {
  Dimensions,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { HomeScreen } from "../HomeScreen"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import type { WatchHomeModel } from "../../../lib/watchHome/model"
import {
  phoneLocales,
  tapActionName,
} from "../../../test-utils/uiLocaleFixture"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { feedback } from "../../../styles/shared"

const { useWatchHome } = jest.requireMock("../../../hooks/useWatchHome") as {
  useWatchHome: jest.Mock
}

/** One eligible hero video, so the hero chrome renders. */
function heroModel(): WatchHomeModel {
  return {
    sections: [],
    carousel: {
      pools: [
        {
          id: "pool-a",
          collectionIds: ["pool-a"],
          videos: [
            {
              kind: "video",
              id: "jesus",
              title: "JESUS",
              description: null,
              label: "Feature film",
              slug: "jesus",
              parentSlug: null,
              posterUrl: "https://img.example/jesus.jpg",
              thumbnailUrl: null,
              imageAlt: "JESUS",
              playbackId: null,
              durationSeconds: 7200,
            },
          ],
        },
      ],
      muxInserts: [],
    },
    missingData: [],
  }
}

function setHookState(model: WatchHomeModel | null, error: string | null) {
  useWatchHome.mockReturnValue({
    model,
    recommendationsInsertIndex: null,
    loading: false,
    refreshing: false,
    error,
    refetch: () => {},
  })
}

const mounted: TestInstance[] = []

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(createElement(HomeScreen))
  })
  mounted.push(renderer)
  return renderer
}

async function changePhoneLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
}

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  mockGlass.on = true
})
afterAll(() => resetLocaleStoreForTests())

describe("Home's error state", () => {
  it("reads the catalog and keeps the retry tap name", async () => {
    setHookState(null, "any failure")
    const home = await render()
    expect(hasText(home, "Something went wrong")).toBe(true)
    expect(hasText(home, "Couldn't load videos. Please try again.")).toBe(true)
    const english = tapActionName(pressableByLabel(home, "Retry loading"))

    await changePhoneLanguage("es-ES")

    expect(hasText(home, "Algo salió mal")).toBe(true)
    expect(hasText(home, "No se pudieron cargar los videos.")).toBe(true)
    expect(hasText(home, "Reintentar")).toBe(true)
    const spanish = tapActionName(pressableByLabel(home, "Reintentar la carga"))
    expect(spanish).toBe(english)
    expect(english).toBe("home-load-retry")
  })
})

describe("Home's hero controls", () => {
  it("relabel in place and keep their tap names", async () => {
    setHookState(heroModel(), null)
    const home = await render()
    expect(hasText(home, "Watch Now")).toBe(true)
    const english = [
      tapActionName(pressableByLabel(home, "Watch JESUS now")),
      tapActionName(pressableByLabel(home, "Unmute video")),
    ]

    await changePhoneLanguage("es-ES")

    expect(hasText(home, "Ver ahora")).toBe(true)
    // A key the fixture lacks shows English, never the key name.
    const spanish = [
      tapActionName(pressableByLabel(home, "Ver JESUS ahora")),
      tapActionName(pressableByLabel(home, "Unmute video")),
    ]
    expect(spanish).toEqual(english)
    expect(english).toEqual(["hero-card", "hero-mute-toggle"])
  })
})

describe("Home's hero mute glass (R8, AE6)", () => {
  function hostOf(home: TestInstance, test: (n: RenderedNode) => boolean) {
    const found = home.root.findAll(
      (n) => typeof n.type === "string" && test(n),
    )
    expect(found).toHaveLength(1)
    return found[0]
  }
  const chrome = (home: TestInstance) =>
    hostOf(home, (n) => n.props.testID === "home-hero-chrome")
  const watchNow = (home: TestInstance) =>
    hostOf(home, (n) => n.props.accessibilityLabel === "Watch JESUS now")
  const muteButton = (home: TestInstance) =>
    hostOf(home, (n) => n.props.accessibilityLabel === "Unmute video")
  const glass = (home: TestInstance) =>
    hostOf(home, (n) => n.type === "GlassView")
  /** The host node right behind the mute glyph. */
  function behindMuteGlyph(home: TestInstance): RenderedNode {
    const [glyph] = home.root.findAll((n) => n.props.name === "volume-mute")
    let at = glyph?.parent
    while (at != null && typeof at.type !== "string") at = at.parent
    if (at == null) throw new Error("no host node behind the mute glyph")
    return at
  }
  const ownStyle = (node: RenderedNode) =>
    StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}

  /** The opacity a node draws at: its own times every host node above it. */
  function drawnOpacity(node: RenderedNode): number {
    let opacity = 1
    for (let at: RenderedNode | null | undefined = node; at; at = at.parent) {
      if (typeof at.type !== "string") continue
      const own = ownStyle(at).opacity
      if (typeof own === "number") opacity *= own
    }
    return opacity
  }

  /** Scrolls the feed until the chrome should sit at this opacity. HomeScreen
   *  fades it over the first 30% of a hero 1.2 screen widths tall. */
  async function scrollChromeTo(opacity: number) {
    const heroHeight = Math.round(Dimensions.get("window").width * 1.2)
    const y = (1 - opacity) * heroHeight * 0.3
    await act(async () => {
      mockFeed.onScroll?.({ nativeEvent: { contentOffset: { y } } })
    })
  }

  beforeEach(() => setHookState(heroModel(), null))

  it("dissolves the mute glass where the chrome stops taking touches, and brings it back at the top", async () => {
    const home = await render()

    await scrollChromeTo(0.6)
    expect(drawnOpacity(watchNow(home))).toBeCloseTo(0.6)
    expect(chrome(home).props.pointerEvents).toBe("box-none")
    expect(glass(home).props.glassEffectStyle).toMatchObject({
      style: "regular",
    })

    await scrollChromeTo(0.4)
    expect(drawnOpacity(watchNow(home))).toBeCloseTo(0.4)
    expect(chrome(home).props.pointerEvents).toBe("none")
    expect(glass(home).props.glassEffectStyle).toMatchObject({
      style: "none",
    })

    await scrollChromeTo(1)
    expect(chrome(home).props.pointerEvents).toBe("box-none")
    expect(glass(home).props.glassEffectStyle).toMatchObject({
      style: "regular",
    })
  })

  it("on glass, fades each part instead of the chrome root", async () => {
    const home = await render()
    await scrollChromeTo(0.6)

    expect(ownStyle(chrome(home)).opacity).toBeUndefined()
    expect(drawnOpacity(watchNow(home))).toBeCloseTo(0.6)
    expect(drawnOpacity(behindMuteGlyph(home))).toBeCloseTo(0.6)
    // Any opacity below 1 above the glass stops it drawing.
    expect(drawnOpacity(glass(home))).toBe(1)
    expect(ownStyle(glass(home)).backgroundColor).toBeUndefined()
  })

  it("keeps today's chrome fade and the mute's dark fill where Liquid Glass is unavailable", async () => {
    mockGlass.on = false
    const home = await render()
    await scrollChromeTo(0.6)

    expect(ownStyle(chrome(home)).opacity).toBe(0.6)
    // One fade only: the mute does not fade a second time.
    expect(drawnOpacity(behindMuteGlyph(home))).toBeCloseTo(0.6)
    expect(ownStyle(behindMuteGlyph(home)).backgroundColor).toBe(
      "rgba(0, 0, 0, 0.5)",
    )
    expect(home.root.findAll((n) => n.type === "GlassView")).toHaveLength(0)
  })

  it("scales the pressed mute on glass, and dims it elsewhere", async () => {
    for (const on of [true, false]) {
      mockGlass.on = on
      const home = await render()
      const event = {
        persist: () => {},
        currentTarget: { measure: () => {} },
        nativeEvent: { pageX: 0, pageY: 0, touches: [], changedTouches: [] },
      }
      await act(async () => {
        ;(muteButton(home).props.onResponderGrant as (e: unknown) => void)(
          event,
        )
      })
      const surface = behindMuteGlyph(home)
      if (on) {
        expect(drawnOpacity(glass(home))).toBe(1)
        expect(ownStyle(glass(home)).transform).toEqual([{ scale: 0.92 }])
      } else {
        expect(drawnOpacity(surface)).toBeCloseTo(feedback.pressed.opacity)
      }
    }
  })
})
