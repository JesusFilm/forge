/**
 * U7 (R9, KTD16): Discover asks in the UI language, pins it to each search
 * generation, and runs the visible query again after a change. An old page
 * never joins the new list. React re-points: "Component render tests".
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
}
const mockCalls: MockCall[] = []
const mockTopics: { onSelect: ((term: string) => void) | null } = {
  onSelect: null,
}
const mockGetLocales = jest.fn()

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
      { ru: {} },
    ),
)
jest.mock("../../../src/i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../src/test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../src/i18n/pluralData.generated"),
      ["ru"],
    ),
)
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: () => {} }),
  useIsFocused: () => true,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
jest.mock("@expo/vector-icons/Ionicons", () => () => null)
jest.mock("../../../src/lib/apolloClient", () => ({
  getApolloClient: () => ({
    query: (options: { variables: { input: Record<string, unknown> } }) =>
      new Promise((resolve) => {
        mockCalls.push({ input: options.variables.input, resolve })
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
  useExperienceSelection: () => ({ selectExperience: () => {} }),
}))
jest.mock("../../../src/lib/tabBar", () => ({
  useTabBarClearance: () => 0,
}))
jest.mock("../../../src/components/search/SearchResultCard", () => {
  const { Text } = jest.requireActual("react-native")
  const { createElement } = jest.requireActual("react")
  return {
    SearchResultCard: ({ result }: { result: { title: string } }) =>
      createElement(Text, { testID: "result" }, result.title),
  }
})
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
import { recordResultsViewed } from "../../../src/lib/watchSearchEvents"
import { phoneLocales } from "../../../src/test-utils/uiLocaleFixture"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

function result(id: string, title: string) {
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
    label: null,
    childCount: null,
    durationSeconds: 60,
  }
}

function page(ids: readonly string[], language: string, nextOffset: number) {
  return {
    data: {
      watchSearch: {
        query: "jesus",
        hasMore: true,
        nextOffset,
        results: ids.map((id) => result(id, `${language} ${id}`)),
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

async function type(renderer: TestInstance, text: string): Promise<void> {
  const input = renderer.root.findAll((node) => node.type === TextInput)[0]
  const onChangeText = input?.props.onChangeText as
    | ((value: string) => void)
    | undefined
  expect(onChangeText).toBeDefined()
  act(() => {
    onChangeText?.(text)
  })
  await settle(300)
}

async function answer(call: MockCall, value: unknown): Promise<void> {
  await act(async () => {
    call.resolve(value)
  })
  await settle()
}

function titles(renderer: TestInstance): string[] {
  return renderer.root
    .findAll((node) => node.props.testID === "result")
    .filter((node) => typeof node.props.children === "string")
    .map((node) => String(node.props.children))
    .filter((title, index, all) => all.indexOf(title) === index)
}

function pressLoadMore(renderer: TestInstance): void {
  const button = renderer.root.findAll(
    (node) =>
      node.props.children === "Load more" &&
      typeof node.props.onPress === "function",
  )[0]
  const onPress = button?.props.onPress as (() => void) | undefined
  expect(onPress).toBeDefined()
  act(() => {
    onPress?.()
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  mockCalls.length = 0
  mockTopics.onSelect = null
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

describe("Discover search language (U7)", () => {
  it("asks in the UI's text slug and names no query language for a typed query", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    resetLocaleStoreForTests()
    startLocaleSync()
    const screen = render()
    await type(screen, "jesus")
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]!.input.displayLanguageSlug).toBe("russian")
    expect(mockCalls[0]!.input).not.toHaveProperty("queryLanguageSlug")
  })

  it("names English as the query language of a browse topic", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    resetLocaleStoreForTests()
    startLocaleSync()
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
    await answer(mockCalls[0]!, page(["a", "b"], "english", 2))
    expect(titles(screen)).toEqual(["english a", "english b"])

    // A page starts in English, then the UI language changes under it.
    pressLoadMore(screen)
    expect(mockCalls[1]!.input).toMatchObject({
      displayLanguageSlug: "english",
      offset: 2,
    })
    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    await act(async () => {
      refreshLocale()
    })
    await settle()

    // The visible query runs again, in Russian, from the first page.
    expect(mockCalls[2]!.input).toMatchObject({
      query: "jesus",
      displayLanguageSlug: "russian",
      offset: 0,
    })
    expect(mockCalls).toHaveLength(3)

    // The English page lands late: it must not join any list.
    await answer(mockCalls[1]!, page(["c", "d"], "english", 4))
    expect(titles(screen)).not.toContain("english c")

    await answer(mockCalls[2]!, page(["x", "y"], "russian", 2))
    expect(titles(screen)).toEqual(["russian x", "russian y"])

    // The next page belongs to the Russian generation.
    await settle(1_000)
    pressLoadMore(screen)
    expect(mockCalls[3]!.input).toMatchObject({
      displayLanguageSlug: "russian",
      offset: 2,
    })
    await answer(mockCalls[3]!, page(["z"], "russian", 3))
    expect(titles(screen)).toEqual(["russian x", "russian y", "russian z"])
  })

  it("reports the viewed results with the search's own language slug", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    resetLocaleStoreForTests()
    startLocaleSync()
    const screen = render()
    await type(screen, "jesus")
    await answer(mockCalls[0]!, page(["a"], "russian", 1))
    expect(recordResultsViewed).toHaveBeenCalledWith(
      expect.objectContaining({ searchLanguageSlug: "russian" }),
    )
  })

  it("sends nothing on a language change while no search is on screen", async () => {
    render()
    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    await act(async () => {
      refreshLocale()
    })
    await settle()
    expect(mockCalls).toHaveLength(0)
  })
})
