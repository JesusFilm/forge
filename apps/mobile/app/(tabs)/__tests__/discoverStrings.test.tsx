/** Discover in the UI language: the search language of each generation (U7,
 *  R9, KTD16) and the catalog text, with one tap name per control (U10). Also
 *  the Daily Bible Pause v2 hand-off of a question (R16, KTD6).
 *  React re-points: "Component render tests". */

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
const mockTopics: { onSelect: ((term: string) => void) | null } = {
  onSelect: null,
}
const mockGetLocales = jest.fn()
const mockFocus = { value: true }
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
  useIsFocused: () => mockFocus.value,
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
  BrowseTopics: ({ onSelect }: { onSelect: (term: string) => void }) => {
    mockTopics.onSelect = onSelect
    return null
  },
}))
jest.mock("../../../src/components/search/useSearchPreviewCycle", () => ({
  useSearchPreviewCycle: () => -1,
}))

import { StrictMode, act, createElement } from "react"
import type React from "react"
import { Animated, TextInput } from "react-native"

import DiscoverScreen from "../watch"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../src/i18n/localeStore"
import { getSearchIntentStore } from "../../../src/lib/searchIntent"
import { recordResultsViewed } from "../../../src/lib/watchSearchEvents"
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

function video(id: string, title: string) {
  return {
    type: "VIDEO",
    id,
    slug: `slug-${id}`,
    title,
    imageUrl: null,
    snippet: null,
    startSeconds: null,
    playbackId: null,
    score: null,
    label: null as string | null,
    childCount: null as number | null,
    durationSeconds: null,
  }
}

const SERIES = {
  ...video("a", "The Chosen Few"),
  label: "SERIES",
  childCount: 3,
}

function videos(language: string, ...ids: string[]) {
  return ids.map((id) => video(id, `${language} ${id}`))
}

function page(
  results: readonly object[],
  { hasMore = true, nextOffset = results.length } = {},
) {
  return {
    data: {
      watchSearch: {
        query: "jesus",
        hasMore,
        nextOffset,
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

function screenElement(): React.ReactElement {
  return createElement(
    StrictMode,
    null,
    createElement(DiscoverScreen),
  ) as unknown as React.ReactElement
}

function render(): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(screenElement())
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

function startIn(tag: string): void {
  resetLocaleStoreForTests()
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  startLocaleSync()
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

function pressText(renderer: TestInstance, text: string): void {
  const onPress = pressableText(renderer, text).props.onPress as () => void
  // A sync act scope: an unawaited async one never flushes later updates.
  act(() => {
    onPress()
  })
}

/** The result titles on screen, read from each card's spoken label. */
function titles(renderer: TestInstance): unknown[] {
  return renderer.root
    .findAll(
      (node) =>
        node.props["dd-action-name"] === "search-result" &&
        typeof node.props.onPress === "function",
    )
    .map((node) => node.props.accessibilityLabel)
}

beforeEach(() => {
  jest.useFakeTimers()
  mockCalls.length = 0
  mockTopics.onSelect = null
  mockFocus.value = true
  getSearchIntentStore().clear()
  startIn("en-US")
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

describe("Discover search language (U7)", () => {
  it("asks in the UI's text slug and names no query language for a typed query", async () => {
    startIn("ru-RU")
    const screen = render()
    await type(screen, "jesus")
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]!.input.displayLanguageSlug).toBe("russian")
    expect(mockCalls[0]!.input).not.toHaveProperty("queryLanguageSlug")
  })

  it("names English as the query language of a browse topic", async () => {
    startIn("ru-RU")
    render()
    await act(async () => {
      mockTopics.onSelect?.("family")
    })
    await settle()
    expect(mockCalls[0]!.input).toMatchObject({
      query: "family",
      displayLanguageSlug: "russian",
      queryLanguageSlug: "english",
    })
  })

  it("runs the visible query again in the new language, and never appends an old-language page", async () => {
    const screen = render()
    await type(screen, "jesus")
    await answer(mockCalls[0]!, page(videos("english", "a", "b")))
    expect(titles(screen)).toEqual(["english a", "english b"])

    // A page starts in English, then the UI language changes under it.
    pressText(screen, "Load more")
    expect(mockCalls[1]!.input).toMatchObject({
      displayLanguageSlug: "english",
      offset: 2,
    })
    await changePhoneLanguage("ru-RU")
    await settle()

    // The visible query runs again, in Russian, from the first page.
    expect(mockCalls[2]!.input).toMatchObject({
      query: "jesus",
      displayLanguageSlug: "russian",
      offset: 0,
    })
    expect(mockCalls).toHaveLength(3)

    // The English page lands late: it must not join any list.
    await answer(
      mockCalls[1]!,
      page(videos("english", "c", "d"), { nextOffset: 4 }),
    )
    expect(titles(screen)).not.toContain("english c")

    await answer(mockCalls[2]!, page(videos("russian", "x", "y")))
    expect(titles(screen)).toEqual(["russian x", "russian y"])

    // The next page belongs to the Russian generation.
    await settle(1_000)
    pressText(screen, "Показать ещё")
    expect(mockCalls[3]!.input).toMatchObject({
      displayLanguageSlug: "russian",
      offset: 2,
    })
    await answer(mockCalls[3]!, page(videos("russian", "z"), { nextOffset: 3 }))
    expect(titles(screen)).toEqual(["russian x", "russian y", "russian z"])
  })

  it("reports the viewed results with the search's own language slug", async () => {
    startIn("ru-RU")
    const screen = render()
    await type(screen, "jesus")
    await answer(mockCalls[0]!, page(videos("russian", "a")))
    expect(recordResultsViewed).toHaveBeenCalledWith(
      expect.objectContaining({ searchLanguageSlug: "russian" }),
    )
  })

  it("sends nothing on a language change while no search is on screen", async () => {
    render()
    await changePhoneLanguage("ru-RU")
    await settle()
    expect(mockCalls).toHaveLength(0)
  })
})

describe("Discover text (U10)", () => {
  it("names the search field and the empty result in English", async () => {
    const screen = render()
    expect(input(screen).props.placeholder).toBe(
      "Search for videos about any topic...",
    )
    expect(input(screen).props.accessibilityLabel).toBe("Search")

    await type(screen, " jesus ")
    await answer(mockCalls[0]!, page([], { hasMore: false }))

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
    await answer(mockCalls[0]!, page([], { hasMore: false }))

    expect(hasText(screen, "Ничего не найдено по запросу «jesus»")).toBe(true)
  })

  it("relabels a result cell whose props did not change", async () => {
    const screen = render()
    await type(screen, "jesus")
    await answer(mockCalls[0]!, page([SERIES]))
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
    await answer(mockCalls[1]!, page([SERIES]))
    expect(hasText(screen, "Показать ещё")).toBe(true)
    expect(hasText(screen, "Load more")).toBe(false)
  })

  it("keeps each moved control's tap name in both languages", async () => {
    const screen = render()
    await type(screen, "jesus")
    await answer(mockCalls[0]!, page([SERIES]))
    const english = [
      tapActionName(pressableByLabel(screen, "Clear search")),
      tapActionName(pressableText(screen, "Load more")),
    ]

    await changePhoneLanguage("ru-RU")
    await settle()
    await answer(mockCalls[1]!, page([SERIES]))

    const russian = [
      tapActionName(pressableByLabel(screen, "Очистить поиск")),
      tapActionName(pressableText(screen, "Показать ещё")),
    ]
    expect(russian).toEqual(english)
    expect(english).toEqual(["discover-search-clear", "discover-load-more"])
  })
})

describe("Daily Bible Pause hand-off (v2 R16, KTD6)", () => {
  const QUESTION = "How are we commanded to pray?"

  function handOver(question = QUESTION): void {
    act(() => {
      getSearchIntentStore().put(question)
    })
  }

  function queries(): unknown[] {
    return mockCalls.map((call) => call.input.query)
  }

  it("replaces a typed query and its pending debounce with the question (AE7)", async () => {
    const screen = render()
    const onChangeText = input(screen).props.onChangeText as (
      value: string,
    ) => void
    act(() => onChangeText("Jesus"))
    expect(input(screen).props.value).toBe("Jesus")

    handOver()
    await settle()
    expect(input(screen).props.value).toBe(QUESTION)
    expect(queries()).toEqual([QUESTION])

    // The debounce for "Jesus" never fires.
    await settle(1_000)
    expect(queries()).toEqual([QUESTION])
    expect(input(screen).props.value).toBe(QUESTION)
  })

  it("applies an intent that waits at mount once, under StrictMode", async () => {
    handOver()
    const screen = render()
    await settle(1_000)

    expect(input(screen).props.value).toBe(QUESTION)
    expect(queries()).toEqual([QUESTION])
    expect(getSearchIntentStore().peek()).toBeNull()
  })

  it("runs the search again when the same question comes twice", async () => {
    const screen = render()
    handOver()
    await settle()
    await answer(mockCalls[0]!, page(videos("english", "a")))

    handOver()
    await settle()
    expect(queries()).toEqual([QUESTION, QUESTION])
    expect(input(screen).props.value).toBe(QUESTION)
  })

  it("does not apply a consumed intent again on focus or on a new mount", async () => {
    const screen = render()
    handOver()
    await settle()
    await answer(mockCalls[0]!, page(videos("english", "a")))
    // The viewer moves on to a query of their own.
    await type(screen, "Jesus")
    expect(queries()).toEqual([QUESTION, "Jesus"])

    mockFocus.value = false
    act(() => screen.update(screenElement()))
    mockFocus.value = true
    act(() => screen.update(screenElement()))
    await settle(1_000)
    expect(input(screen).props.value).toBe("Jesus")

    const fresh = render()
    await settle(1_000)
    expect(input(fresh).props.value).toBe("")
    expect(queries()).toEqual([QUESTION, "Jesus"])
  })

  it("asks with English as the query language under a Russian UI", async () => {
    startIn("ru-RU")
    render()
    handOver()
    await settle()

    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]!.input).toMatchObject({
      query: QUESTION,
      displayLanguageSlug: "russian",
      queryLanguageSlug: "english",
    })
  })
})
