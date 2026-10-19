/** Discover in the UI language: the search language of each generation (U7,
 *  R9, KTD16) and the catalog text, with one tap name per control (U10).
 *  On Liquid Glass, the native search field (feat-705 U13, KTD9).
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
// Stable identities, as in the app: a new callback each render would re-render
// every memoized cell and hide a cell that misses the language change.
// The native field and the router write here, so a case can read their order.
const mockOrder: string[] = []
const mockRouter = { push: (href: string) => mockOrder.push(`push:${href}`) }
const mockSelection = { selectExperience: () => {} }
// KTD1. Off by default, so the other cases render today's field.
const mockGlass = { current: false }
const mockSearchBar: { props: Record<string, unknown> | null } = {
  props: null,
}
const mockSearchBarCommands = {
  setText: jest.fn(),
  blur: jest.fn(() => mockOrder.push("blur")),
}

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
  Stack: {
    // The real one hands its props to the native header and renders nothing.
    SearchBar: (props: { ref?: { current: unknown } }) => {
      mockSearchBar.props = props
      if (props.ref) props.ref.current = mockSearchBarCommands
      return null
    },
  },
}))
jest.mock("../../../src/lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGlass.current,
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
    const { createElement: h } =
      jest.requireActual<typeof import("react")>("react")
    const { Text: RNText } =
      jest.requireActual<typeof import("react-native")>("react-native")
    return h(RNText, null, "browse-topics")
  },
}))
jest.mock("../../../src/components/search/useSearchPreviewCycle", () => ({
  useSearchPreviewCycle: () => -1,
}))

import { StrictMode, act, createElement } from "react"
import type React from "react"
import { Animated, TextInput } from "react-native"

import DiscoverScreen from "../watch/index"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../src/i18n/localeStore"
import { reportDatadogAction } from "../../../src/lib/datadog"
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

function render(): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      createElement(
        StrictMode,
        null,
        createElement(DiscoverScreen),
      ) as unknown as React.ReactElement,
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
  mockOrder.length = 0
  mockGlass.current = false
  mockSearchBar.props = null
  mockSearchBarCommands.setText.mockClear()
  mockSearchBarCommands.blur.mockClear()
  jest.mocked(reportDatadogAction).mockClear()
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

describe("Discover native search (feat-705 U13)", () => {
  function searchBar(): Record<string, unknown> {
    expect(mockSearchBar.props).not.toBeNull()
    return mockSearchBar.props!
  }

  /** The event the native field sends: the text sits on nativeEvent. */
  function nativeType(text: string): void {
    const onChangeText = searchBar().onChangeText as (event: {
      nativeEvent: { text: string }
    }) => void
    act(() => onChangeText({ nativeEvent: { text } }))
  }

  // A count, never the nodes: a failing diff of fibers can exhaust memory.
  function textInputCount(renderer: TestInstance): number {
    return renderer.root.findAll((node) => node.type === TextInput).length
  }

  function pressFirstResult(renderer: TestInstance): void {
    const card = renderer.root.findAll(
      (node) =>
        node.props["dd-action-name"] === "search-result" &&
        typeof node.props.onPress === "function",
    )[0]
    expect(card).toBeDefined()
    act(() => card!.props.onPress!())
  }

  it("shows the native field on Liquid Glass, with the catalog placeholder, and no field of its own", async () => {
    mockGlass.current = true
    const screen = render()
    expect(textInputCount(screen)).toBe(0)
    expect(searchBar()).toMatchObject({
      placement: "automatic",
      placeholder: "Search for videos about any topic...",
      autoCapitalize: "none",
    })
    // KTD9: `stacked` or `false` gives an empty capsule.
    expect(searchBar().allowToolbarIntegration).toBeUndefined()

    await changePhoneLanguage("ru-RU")
    expect(searchBar().placeholder).toBe("Поиск видео на любую тему...")
  })

  // Stack.SearchBar re-registers the header whenever a prop changes identity.
  it("keeps the native field's handlers across renders", async () => {
    mockGlass.current = true
    const screen = render()
    const before = searchBar()
    nativeType("jesus")
    await settle(300)
    await answer(mockCalls[0]!, page(videos("english", "a")))
    expect(titles(screen)).toEqual(["english a"])
    expect(searchBar()).not.toBe(before)
    expect(searchBar().onChangeText).toBe(before.onChangeText)
    expect(searchBar().onCancelButtonPress).toBe(before.onCancelButtonPress)
  })

  it("keeps today's field, and mounts no native field, without Liquid Glass", () => {
    const screen = render()
    expect(textInputCount(screen)).toBe(1)
    expect(mockSearchBar.props).toBeNull()
  })

  it("runs the debounced search with the text of a change event", async () => {
    mockGlass.current = true
    render()
    nativeType("jesus")
    await settle(299)
    expect(mockCalls).toHaveLength(0)
    await settle(1)
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]!.input).toMatchObject({ query: "jesus", offset: 0 })
  })

  it("clears at once on Cancel, shows the categories, and reports one clear action", async () => {
    mockGlass.current = true
    const screen = render()
    nativeType("jesus")
    await settle(300)
    await answer(mockCalls[0]!, page(videos("english", "a")))
    expect(titles(screen)).toEqual(["english a"])
    expect(hasText(screen, "browse-topics")).toBe(false)

    // The native order: the cancel event, then a change event with "".
    const onCancel = searchBar().onCancelButtonPress as () => void
    act(() => onCancel())
    nativeType("")
    await settle()

    expect(titles(screen)).toEqual([])
    expect(hasText(screen, "browse-topics")).toBe(true)
    expect(reportDatadogAction).toHaveBeenCalledTimes(1)
    expect(reportDatadogAction).toHaveBeenCalledWith("discover-search-clear")

    // The trailing change event's debounce sends nothing and reports nothing.
    await settle(300)
    expect(mockCalls).toHaveLength(1)
    expect(reportDatadogAction).toHaveBeenCalledTimes(1)
  })

  it("reports nothing from today's clear button, which the tap name covers", async () => {
    const screen = render()
    await type(screen, "jesus")
    await answer(mockCalls[0]!, page(videos("english", "a")))
    const clear = pressableByLabel(screen, "Clear search")
    act(() => clear!.props.onPress!())
    await settle()
    expect(hasText(screen, "browse-topics")).toBe(true)
    expect(reportDatadogAction).not.toHaveBeenCalled()
  })

  it("puts a topic in the native field and searches once", async () => {
    mockGlass.current = true
    render()
    await act(async () => {
      mockTopics.onSelect?.("family")
    })
    await settle()
    expect(mockSearchBarCommands.setText).toHaveBeenCalledTimes(1)
    expect(mockSearchBarCommands.setText).toHaveBeenCalledWith("family")
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]!.input).toMatchObject({ query: "family" })
    await settle(300)
    expect(mockCalls).toHaveLength(1)
  })

  it("blurs the native field before it opens a result", async () => {
    mockGlass.current = true
    const screen = render()
    nativeType("jesus")
    await settle(300)
    await answer(mockCalls[0]!, page(videos("english", "a")))
    pressFirstResult(screen)
    expect(mockOrder).toEqual([
      "blur",
      expect.stringMatching(/^push:\/watch\/slug-a\?/),
    ])
  })
})
