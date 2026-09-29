/**
 * U10: Discover's text reads the catalog. A result cell whose props do not
 * change still takes the new language, and each moved control keeps one tap
 * name in both languages. React re-points: "Component render tests".
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

// The `mock` prefix is required: babel-plugin-jest-hoist lifts every jest.mock
// above these declarations. Each factory reads them at call time only.
type MockCall = {
  input: Record<string, unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}
const mockCalls: MockCall[] = []
const mockGetLocales = jest.fn()
// Stable identities, as in the app: a new callback each render would re-render
// every memoized cell and hide a cell that misses the language change.
const mockRouter = { push: () => {} }
const mockSelection = { selectExperience: () => {} }

jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../../src/i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../src/test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../src/i18n/catalogs.generated"),
      {
        ru: {
          Home: {
            episodeCount:
              "{count, plural, one {# эпизод} few {# эпизода} many {# эпизодов} other {# эпизода}}",
          },
          Discover: {
            searchPlaceholder: "Поиск видео на любую тему...",
            searchFieldAriaLabel: "Поиск",
            clearSearchAriaLabel: "Очистить поиск",
            noResultsTitle: "Ничего не найдено по запросу «{query}»",
            loadMore: "Показать ещё",
            failedError: "Поиск не удался. Попробуйте ещё раз.",
            retry: "Повторить",
          },
        },
      },
    ),
)
jest.mock("../../../src/i18n/pluralData.generated", () => {
  const actual = jest.requireActual("../../../src/i18n/pluralData.generated")
  return {
    ...actual,
    PLURAL_DATA_TAG: { ...actual.PLURAL_DATA_TAG, ru: "ru" },
    PLURAL_DATA_LOADERS: {
      ...actual.PLURAL_DATA_LOADERS,
      ru: () =>
        jest.requireActual("@formatjs/intl-pluralrules/locale-data/ru.js"),
    },
  }
})
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useIsFocused: () => true,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
jest.mock("@expo/vector-icons/Ionicons", () => () => null)
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("../../../src/lib/apolloClient", () => ({
  getApolloClient: () => ({
    query: (options: { variables: { input: Record<string, unknown> } }) =>
      new Promise((resolve, reject) => {
        mockCalls.push({ input: options.variables.input, resolve, reject })
      }),
  }),
}))
jest.mock("../../../src/lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
}))
jest.mock("../../../src/lib/watchSearchEvents", () => ({
  recordResultClicked: jest.fn(async () => undefined),
  recordResultsViewed: jest.fn(async () => undefined),
}))
jest.mock("../../../src/contexts/ExperienceSelectionProvider", () => ({
  useExperienceSelection: () => mockSelection,
}))
jest.mock("../../../src/lib/tabBar", () => ({
  useTabBarClearance: () => 0,
}))
jest.mock("../../../src/components/watch/WatchProgressBar", () => ({
  WatchProgressBar: () => null,
}))
jest.mock("../../../src/components/search/SearchPreviewImage", () => ({
  SearchPreviewImage: () => null,
}))
jest.mock("../../../src/components/search/SearchResultSkeleton", () => ({
  SearchResultSkeleton: () => null,
}))
jest.mock("../../../src/components/search/BrowseTopics", () => ({
  BrowseTopics: () => null,
}))
jest.mock("../../../src/components/search/useSearchPreviewCycle", () => ({
  useSearchPreviewCycle: () => -1,
}))

import { act, createElement } from "react"
import type React from "react"
import { Animated, TextInput } from "react-native"

import DiscoverScreen from "../watch"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../src/i18n/localeStore"
import {
  phoneLocales,
  tapActionName,
} from "../../../src/test-utils/uiLocaleFixture"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

const SERIES = {
  type: "VIDEO",
  id: "a",
  slug: "slug-a",
  title: "The Chosen Few",
  imageUrl: null,
  snippet: null,
  startSeconds: null,
  playbackId: null,
  score: null,
  label: "SERIES",
  childCount: 3,
  durationSeconds: null,
}

function page(results: readonly object[], hasMore: boolean) {
  return {
    data: {
      watchSearch: {
        query: "jesus",
        hasMore,
        nextOffset: results.length,
        results,
        requestId: null,
        latencyMs: null,
        degraded: null,
        searchMode: null,
      },
    },
  }
}

const mounted: TestInstance[] = []

function render(): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      createElement(DiscoverScreen) as unknown as React.ReactElement,
    )
  })
  mounted.push(renderer)
  return renderer
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    if (ms > 0) jest.advanceTimersByTime(ms)
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  })
}

function input(renderer: TestInstance): RenderedNode {
  const found = renderer.root.findAll((node) => node.type === TextInput)[0]
  expect(found).toBeDefined()
  return found!
}

async function type(renderer: TestInstance, text: string): Promise<void> {
  const onChangeText = input(renderer).props.onChangeText as (
    value: string,
  ) => void
  act(() => onChangeText(text))
  await settle(300)
}

async function answer(call: MockCall, value: unknown): Promise<void> {
  await act(async () => {
    call.resolve(value)
  })
  await settle()
}

async function changePhoneLanguage(tag: string): Promise<void> {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
}

/** The Text node that holds exactly this string, with its press handler. */
function pressableText(renderer: TestInstance, text: string): RenderedNode {
  const found = renderer.root.findAll(
    (node) =>
      node.props.children === text && typeof node.props.onPress === "function",
  )[0]
  expect(found).toBeDefined()
  return found!
}

beforeEach(() => {
  jest.useFakeTimers()
  mockCalls.length = 0
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
  // The results animate on the native driver, which jest does not run.
  jest.spyOn(Animated, "parallel").mockImplementation(
    () =>
      ({
        start: (done?: (result: { finished: boolean }) => void) =>
          done?.({ finished: true }),
        stop: () => {},
        reset: () => {},
      }) as unknown as Animated.CompositeAnimation,
  )
})

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.restoreAllMocks()
  jest.useRealTimers()
  resetLocaleStoreForTests()
})

describe("Discover text (U10)", () => {
  it("names the search field and the empty result in English", async () => {
    const screen = render()
    expect(input(screen).props.placeholder).toBe(
      "Search for videos about any topic...",
    )
    expect(input(screen).props.accessibilityLabel).toBe("Search")

    await type(screen, " jesus ")
    await answer(mockCalls[0]!, page([], false))

    expect(hasText(screen, "No results for 'jesus'")).toBe(true)
    expect(
      hasText(screen, "Try different keywords or browse experiences"),
    ).toBe(true)
  })

  it("shows a failed search in English with its retry", async () => {
    const screen = render()
    await type(screen, "jesus")
    await act(async () => {
      mockCalls[0]!.reject(new Error("offline"))
    })
    await settle()

    expect(hasText(screen, "Search failed. Please try again.")).toBe(true)
    expect(tapActionName(pressableText(screen, "Retry"))).toBe(
      "discover-search-retry",
    )
  })

  it("puts the query inside the catalog's own quotation marks", async () => {
    await changePhoneLanguage("ru-RU")
    const screen = render()
    await type(screen, "jesus")
    await answer(mockCalls[0]!, page([], false))

    expect(hasText(screen, "Ничего не найдено по запросу «jesus»")).toBe(true)
  })

  it("relabels a result cell whose props did not change", async () => {
    const screen = render()
    await type(screen, "jesus")
    await answer(mockCalls[0]!, page([SERIES], true))
    expect(hasText(screen, "3 episodes")).toBe(true)
    expect(hasText(screen, "Load more")).toBe(true)

    // The visible query runs again in the new language; until that answer
    // lands, the same cell stays on screen with the same props.
    await changePhoneLanguage("ru-RU")
    await settle()
    expect(mockCalls).toHaveLength(2)

    expect(hasText(screen, "3 эпизода")).toBe(true)
    expect(hasText(screen, "3 episodes")).toBe(false)
    expect(input(screen).props.placeholder).toBe("Поиск видео на любую тему...")

    // The rerun retires the pager at once, and its answer brings it back.
    await answer(mockCalls[1]!, page([SERIES], true))
    expect(hasText(screen, "Показать ещё")).toBe(true)
    expect(hasText(screen, "Load more")).toBe(false)
  })

  it("keeps each moved control's tap name in both languages", async () => {
    const screen = render()
    await type(screen, "jesus")
    await answer(mockCalls[0]!, page([SERIES], true))
    const english = [
      tapActionName(pressableByLabel(screen, "Clear search")),
      tapActionName(pressableText(screen, "Load more")),
    ]

    await changePhoneLanguage("ru-RU")
    await settle()
    await answer(mockCalls[1]!, page([SERIES], true))

    const russian = [
      tapActionName(pressableByLabel(screen, "Очистить поиск")),
      tapActionName(pressableText(screen, "Показать ещё")),
    ]
    expect(russian).toEqual(english)
    expect(english).toEqual(["discover-search-clear", "discover-load-more"])
  })
})
