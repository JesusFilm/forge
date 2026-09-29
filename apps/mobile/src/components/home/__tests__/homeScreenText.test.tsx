/** U10: Home's own states and hero controls read the `Home` catalog, and each
 *  moved control keeps one tap name in both languages. The feed's children
 *  stay mocked out, as in homeSplashHandover.test.tsx. */

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
jest.mock("@shopify/flash-list", () => ({ FlashList: () => null }))
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
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

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
