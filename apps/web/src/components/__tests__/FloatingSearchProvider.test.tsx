/**
 * @vitest-environment jsdom
 */
import { act, useEffect, useState, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FloatingSearchController } from "@/components/FloatingSearchController"
import {
  FloatingSearchProvider,
  useFloatingSearch,
} from "@/components/FloatingSearchProvider"
import { runSearch } from "@/lib/search-actions"
import { getSearchLanguageOptions } from "@/lib/search-language-actions"
import type {
  SearchActionResult,
  SearchActionResultSource,
  SearchResult,
} from "@/lib/search"
import {
  WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
  WATCH_PLAYER_CHROME_REVEAL_EVENT,
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  WATCH_PLAYER_PLAYBACK_STATE_EVENT,
  type WatchHeaderLanguageSwitcherDetail,
  type WatchPlayerChromeVisibilityDetail,
  type WatchPlayerPlaybackStateDetail,
} from "@/lib/watch-player-chrome-events"

const navigationMocks = vi.hoisted(() => ({
  pathname: "/",
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
  useRouter: () => ({
    replace: navigationMocks.replace,
  }),
}))

vi.mock("@/lib/search-actions", () => ({
  runSearch: vi.fn(),
}))

vi.mock("@/lib/search-language-actions", () => ({
  getSearchLanguageOptions: vi.fn(async () => ({
    ok: true,
    algoliaEnabled: false,
    options: [],
    countrySuggestion: null,
    recommendedLanguage: null,
    countryCode: null,
    countryName: null,
  })),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  navigationMocks.pathname = "/"
  window.history.replaceState(null, "", "/")
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const mockedRunSearch = vi.mocked(runSearch)
const mockedGetSearchLanguageOptions = vi.mocked(getSearchLanguageOptions)

const englishSearchLanguage = {
  englishName: "English",
  nativeName: "English",
  bcp47: "en",
  publicSlug: "english",
  regionNames: ["Europe"],
}

const spanishSearchLanguage = {
  englishName: "Spanish, Castilian",
  nativeName: "Español",
  bcp47: "es-ES",
  publicSlug: "spanish-castilian",
  regionNames: ["Europe"],
}

function dispatchChromeVisibility(visible: boolean, opacity?: number) {
  window.dispatchEvent(
    new CustomEvent<WatchPlayerChromeVisibilityDetail>(
      WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
      { detail: { visible, opacity } },
    ),
  )
}

function dispatchPlaybackState(detail: WatchPlayerPlaybackStateDetail) {
  window.dispatchEvent(
    new CustomEvent<WatchPlayerPlaybackStateDetail>(
      WATCH_PLAYER_PLAYBACK_STATE_EVENT,
      { detail },
    ),
  )
}

function dispatchLanguageSwitcher(detail: WatchHeaderLanguageSwitcherDetail) {
  window.dispatchEvent(
    new CustomEvent<WatchHeaderLanguageSwitcherDetail>(
      WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
      { detail },
    ),
  )
}

function searchResult(
  source: SearchActionResultSource,
  overrides: Partial<Extract<SearchActionResult, { ok: true }>> = {},
): SearchActionResult {
  return {
    ok: true,
    results: [],
    hasMore: false,
    query: "jesus",
    searchMode: source,
    latencyMs: 1,
    resultSource: source,
    resolvedLanguage: {
      locale: "en",
      publicSlug: "english",
      englishName: "English",
      source: "fallback",
    },
    ...overrides,
  }
}

const videoResult = (id: string): SearchResult => ({
  type: "video",
  id,
  slug: id,
  title: id,
  imageUrl: null,
  snippet: "",
  startSeconds: null,
  playbackId: null,
  score: 1,
  label: "FEATURE_FILM",
  durationSeconds: null,
  childCount: 0,
})

function makeSearchResult(id: string, title: string): SearchResult {
  return {
    type: "video",
    id,
    slug: `${id}-slug`,
    title,
    imageUrl: null,
    snippet: `${title} snippet`,
    startSeconds: null,
    playbackId: `playback-${id}`,
    score: 1,
    label: null,
    durationSeconds: 120,
    childCount: 0,
  }
}

function makeSearchResponse(
  results: SearchResult[],
  hasMore: boolean,
): SearchActionResult {
  return searchResult("semantic", {
    results,
    hasMore,
    query: "the bible project",
    searchMode: "hybrid",
    latencyMs: 12,
  })
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

async function openSearchOverlay(): Promise<HTMLInputElement> {
  act(() => {
    root.render(
      <FloatingSearchProvider>
        <main>Page</main>
      </FloatingSearchProvider>,
    )
  })
  await act(async () => {
    await Promise.resolve()
  })

  const searchButton = document.querySelector(
    '[aria-label="Search videos"]',
  ) as HTMLButtonElement
  await act(async () => {
    searchButton.click()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  await flushSearchControllerMount()

  const input = document.querySelector(
    'input[aria-label="Search videos by keyword"]',
  ) as HTMLInputElement | null
  if (input === null) {
    throw new Error("Expected search overlay input to render")
  }
  return input
}

async function flushSearchControllerMount() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function submitDebouncedSearch(input: HTMLInputElement, query: string) {
  act(() => {
    setInputValue(input, query)
  })
  await act(async () => {
    vi.advanceTimersByTime(300)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function flushResolvedSearch() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function PlaybackStatePublisher({
  detail,
}: {
  detail: WatchPlayerPlaybackStateDetail
}) {
  useEffect(() => {
    dispatchPlaybackState(detail)
  }, [detail])

  return <main>Page</main>
}

function SearchModeHarness() {
  const {
    algoliaSearchEnabled,
    displayResults,
    error,
    loadMore,
    loading,
    search,
    setOpen,
    showSkeleton,
  } = useFloatingSearch()

  return (
    <div>
      <span data-testid="algolia-search-enabled">
        {String(algoliaSearchEnabled)}
      </span>
      <span data-testid="search-result-count">{displayResults.length}</span>
      <span data-testid="search-error">{error ?? ""}</span>
      <span data-testid="search-loading">{String(loading)}</span>
      <span data-testid="search-skeleton">{String(showSkeleton)}</span>
      <button
        type="button"
        data-testid="search-mode-harness-open-button"
        onClick={() => setOpen(true)}
      >
        Open
      </button>
      <button
        type="button"
        data-testid="search-mode-harness-button"
        onClick={() => void search("jesus")}
      >
        Search
      </button>
      <button
        type="button"
        data-testid="search-mode-harness-clear-button"
        onClick={() => void search("")}
      >
        Clear
      </button>
      <button
        type="button"
        data-testid="search-mode-harness-load-more-button"
        onClick={() => void loadMore()}
      >
        Load more
      </button>
    </div>
  )
}

function SearchControllerTestShell({
  children,
  initialOpen = false,
  initialQuery = "",
}: {
  children?: ReactNode
  initialOpen?: boolean
  initialQuery?: string
}) {
  const [open, setOpen] = useState(initialOpen)
  const [query, setQuery] = useState(initialQuery)

  return (
    <FloatingSearchController
      open={open}
      closing={false}
      query={query}
      setOpen={setOpen}
      setQuery={setQuery}
    >
      {children}
    </FloatingSearchController>
  )
}

describe("FloatingSearchProvider — header backdrop", () => {
  it("catches the initial watch preview state published by a child on mount", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <PlaybackStatePublisher
            detail={{ playing: true, muted: true, preview: true }}
          />
        </FloatingSearchProvider>,
      )
    })

    const backdrop = document.querySelector(
      '[data-testid="floating-header-backdrop"]',
    )
    expect(backdrop?.className).toContain("opacity-100")
  })

  it("renders a fixed blurred gradient behind the floating header", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchPlaybackState({ playing: true, muted: true, preview: true })
    })

    const backdrop = document.querySelector(
      '[data-testid="floating-header-backdrop"]',
    )
    expect(backdrop).not.toBeNull()
    expect(backdrop?.className).toContain("fixed")
    expect(backdrop?.className).toContain("z-40")
    expect(backdrop?.className).toContain("pointer-events-none")
    expect(backdrop?.className).toContain(
      "h-[calc(6rem+env(safe-area-inset-top,0px))]",
    )
    expect(backdrop?.className).toContain(
      "md:h-[calc(8rem+env(safe-area-inset-top,0px))]",
    )
    expect(backdrop?.className).toContain("backdrop-blur-[10px]")
    expect(backdrop?.className).toContain("bg-[linear-gradient")
    expect(backdrop?.className).toContain("opacity-100")
  })

  it("hides the header backdrop outside preview mode", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchPlaybackState({ playing: true, muted: true, preview: true })
    })

    const backdrop = document.querySelector(
      '[data-testid="floating-header-backdrop"]',
    )
    expect(backdrop?.className).toContain("opacity-100")

    act(() => {
      dispatchPlaybackState({ playing: false, muted: false, preview: false })
    })

    expect(backdrop?.className).toContain("opacity-0")
  })
})

describe("FloatingSearchProvider — search mode", () => {
  it("uses the server language metadata response to enable Algolia UI on open", async () => {
    mockedGetSearchLanguageOptions.mockResolvedValueOnce({
      ok: true,
      algoliaEnabled: true,
      options: [
        {
          englishName: "English",
          nativeName: "English",
          bcp47: "en",
          publicSlug: "english",
          regionNames: ["Europe"],
        },
        {
          englishName: "Swahili",
          nativeName: "Kiswahili",
          bcp47: "sw",
          publicSlug: "swahili",
          regionNames: ["Africa"],
        },
        {
          englishName: "Hindi",
          nativeName: "हिंदी",
          bcp47: "hi",
          publicSlug: "hindi",
          regionNames: ["Asia"],
        },
        {
          englishName: "Spanish, Latin American",
          nativeName: "Español",
          bcp47: "es-419",
          publicSlug: "spanish-latin-american",
          regionNames: ["South America"],
        },
        {
          englishName: "Navajo",
          nativeName: "Diné Bizaad",
          bcp47: "nv",
          publicSlug: "navajo",
          regionNames: ["North America"],
        },
        {
          englishName: "Fijian",
          nativeName: "Vosa Vakaviti",
          bcp47: "fj",
          publicSlug: "fijian",
          regionNames: ["Oceania"],
        },
      ],
      countrySuggestion: null,
      recommendedLanguage: {
        englishName: "English",
        nativeName: "English",
        bcp47: "en",
        publicSlug: "english",
        regionNames: ["Europe"],
      },
      countryCode: null,
      countryName: null,
    })

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    const state = document.querySelector(
      '[data-testid="algolia-search-enabled"]',
    )
    const openButton = document.querySelector(
      '[data-testid="search-mode-harness-open-button"]',
    ) as HTMLButtonElement

    expect(state?.textContent).toBe("false")

    await act(async () => {
      openButton.click()
      await Promise.resolve()
    })

    expect(state?.textContent).toBe("true")
    expect(document.body.textContent).toContain("Search Suggestions")
    expect(document.body.textContent).toContain("Languages")
    expect(document.body.textContent).toContain("Europe")
    expect(document.body.textContent).toContain("Africa")
    expect(document.body.textContent).toContain("Asia")
    expect(document.body.textContent).toContain("South America")
    expect(document.body.textContent).toContain("North America")
    expect(document.body.textContent).toContain("Oceania")

    const suggestionsTab = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Search Suggestions"),
    )
    await act(async () => {
      suggestionsTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("Recommended language")
    expect(document.body.textContent).toContain("in English")

    vi.mocked(runSearch).mockResolvedValueOnce(searchResult("algolia"))
    const recommendedJesusSuggestion = document.querySelector(
      '[aria-label="Search Jesus in English"]',
    ) as HTMLButtonElement
    await act(async () => {
      recommendedJesusSuggestion.click()
      await Promise.resolve()
    })
    expect(runSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Jesus",
        languageEnglishNames: ["English"],
        languageOptions: expect.arrayContaining([
          expect.objectContaining({ englishName: "English" }),
          expect.objectContaining({ englishName: "Swahili" }),
          expect.objectContaining({ englishName: "Spanish, Latin American" }),
        ]),
      }),
    )
    expect(
      document.querySelector(
        '[data-testid="search-overlay-category-parables"]',
      ),
    ).toBeNull()
  })

  it("uses the manual semantic search language selection for the next search", async () => {
    vi.useFakeTimers()
    mockedGetSearchLanguageOptions.mockResolvedValueOnce({
      ok: true,
      algoliaEnabled: false,
      options: [englishSearchLanguage, spanishSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    mockedRunSearch.mockResolvedValueOnce(searchResult("semantic"))

    const input = await openSearchOverlay()
    const languageToggle = document.querySelector(
      '[aria-controls="search-language-panel"]',
    ) as HTMLButtonElement | null

    expect(languageToggle).not.toBeNull()
    expect(languageToggle?.getAttribute("aria-expanded")).toBe("false")
    expect(document.querySelector("#search-language-autocomplete")).toBeNull()
    expect(document.body.textContent).not.toContain("Browse by region")
    expect(document.body.textContent).not.toContain("Spanish, Castilian")

    await act(async () => {
      languageToggle?.click()
      await Promise.resolve()
    })

    const languageSearchInput = document.querySelector(
      "#search-language-autocomplete",
    ) as HTMLInputElement | null

    expect(languageSearchInput).not.toBeNull()
    expect(languageSearchInput?.value).toBe("English")
    expect(document.body.textContent).toContain("Search language")
    expect(
      document.querySelector("#search-language-autocomplete-listbox"),
    ).not.toBeNull()
    expect(document.body.textContent).toContain("Spanish, Castilian")

    act(() => {
      setInputValue(languageSearchInput as HTMLInputElement, "span")
    })

    const spanishButton = document.querySelector(
      '[role="option"][aria-label="Spanish, Castilian"]',
    ) as HTMLButtonElement | null

    expect(spanishButton).not.toBeNull()

    await act(async () => {
      spanishButton?.click()
      await Promise.resolve()
    })
    await submitDebouncedSearch(input, "jesus")

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "jesus",
        languageEnglishNames: ["Spanish, Castilian"],
        languageSlug: "spanish-castilian",
      }),
    )

    const clearLanguageButton = document.querySelector(
      '[aria-label="Use website default search language"]',
    ) as HTMLButtonElement | null
    expect(clearLanguageButton).not.toBeNull()

    await act(async () => {
      clearLanguageButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: "jesus",
        languageEnglishNames: ["English"],
        languageSlug: "english",
      }),
    )
  })

  it("defaults semantic search language from the Watch route before browser recommendation", async () => {
    vi.useFakeTimers()
    navigationMocks.pathname = "/jesus.html/spanish-castilian.html"
    mockedGetSearchLanguageOptions.mockResolvedValueOnce({
      ok: true,
      algoliaEnabled: false,
      options: [englishSearchLanguage, spanishSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    mockedRunSearch.mockResolvedValueOnce(searchResult("semantic"))

    const input = await openSearchOverlay()
    await submitDebouncedSearch(input, "jesus")

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "jesus",
        languageSlug: "spanish-castilian",
      }),
    )
  })

  it("pauses semantic debounce for a detected query language until confirmed", async () => {
    vi.useFakeTimers()
    mockedGetSearchLanguageOptions.mockResolvedValueOnce({
      ok: true,
      algoliaEnabled: false,
      options: [englishSearchLanguage, spanishSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    mockedRunSearch.mockResolvedValueOnce(searchResult("semantic"))

    const input = await openSearchOverlay()

    act(() => {
      setInputValue(input, "la vida de Jesús en español para niños")
      vi.advanceTimersByTime(400)
    })

    expect(mockedRunSearch).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Spanish detected")

    const confirm = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Search in Spanish",
    ) as HTMLButtonElement | undefined

    await act(async () => {
      confirm?.click()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "la vida de Jesús en español para niños",
        languageEnglishNames: ["Spanish, Castilian"],
        languageSlug: "spanish-castilian",
      }),
    )
  })

  it("waits for semantic language metadata before searching a detectable query", async () => {
    vi.useFakeTimers()
    type LanguageOptionsResponse = Awaited<
      ReturnType<typeof getSearchLanguageOptions>
    >
    let resolveLanguageOptions: (
      value: LanguageOptionsResponse,
    ) => void = () => {}
    const delayedLanguageOptions = new Promise<LanguageOptionsResponse>(
      (resolve) => {
        resolveLanguageOptions = resolve
      },
    )
    mockedGetSearchLanguageOptions.mockReturnValueOnce(delayedLanguageOptions)
    mockedRunSearch.mockResolvedValue(searchResult("semantic"))

    const input = await openSearchOverlay()

    act(() => {
      setInputValue(input, "la vida de Jesús en español para niños")
    })
    await act(async () => {
      vi.advanceTimersByTime(400)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain("Spanish detected")

    await act(async () => {
      resolveLanguageOptions({
        ok: true,
        algoliaEnabled: false,
        options: [englishSearchLanguage, spanishSearchLanguage],
        countrySuggestion: null,
        recommendedLanguage: englishSearchLanguage,
        countryCode: null,
        countryName: null,
      })
      await delayedLanguageOptions
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Spanish detected")

    const confirm = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Search in Spanish",
    ) as HTMLButtonElement | undefined

    await act(async () => {
      confirm?.click()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "la vida de Jesús en español para niños",
        languageEnglishNames: ["Spanish, Castilian"],
        languageSlug: "spanish-castilian",
      }),
    )
  })

  it("uses the latest server search source to toggle Algolia-only UI state", async () => {
    vi.mocked(runSearch)
      .mockResolvedValueOnce(searchResult("algolia"))
      .mockResolvedValueOnce(searchResult("semantic"))

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    const state = document.querySelector(
      '[data-testid="algolia-search-enabled"]',
    )
    const searchButton = document.querySelector(
      '[data-testid="search-mode-harness-button"]',
    ) as HTMLButtonElement

    expect(state?.textContent).toBe("false")

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
    })

    expect(state?.textContent).toBe("true")

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
    })

    expect(state?.textContent).toBe("false")
  })

  it("does not append load-more results if the server search source changes mid-query", async () => {
    vi.mocked(runSearch)
      .mockResolvedValueOnce(
        searchResult("algolia", {
          results: [videoResult("algolia-1")],
          hasMore: true,
          nextOffset: 20,
        }),
      )
      .mockResolvedValueOnce(
        searchResult("semantic", {
          results: [videoResult("semantic-1")],
          hasMore: false,
        }),
      )

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    const searchButton = document.querySelector(
      '[data-testid="search-mode-harness-button"]',
    ) as HTMLButtonElement
    const loadMoreButton = document.querySelector(
      '[data-testid="search-mode-harness-load-more-button"]',
    ) as HTMLButtonElement
    const resultCount = document.querySelector(
      '[data-testid="search-result-count"]',
    )
    const error = document.querySelector('[data-testid="search-error"]')

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
    })

    expect(resultCount?.textContent).toBe("1")

    await act(async () => {
      loadMoreButton.click()
      await Promise.resolve()
    })

    expect(resultCount?.textContent).toBe("1")
    expect(runSearch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        offset: 20,
      }),
    )
    expect(error?.textContent).toBe("Failed to load more results.")
  })

  it("keeps the resolved semantic language when loading more after metadata refresh", async () => {
    navigationMocks.pathname = "/jesus.html/spanish-castilian.html"
    mockedGetSearchLanguageOptions.mockResolvedValueOnce({
      ok: true,
      algoliaEnabled: false,
      options: [englishSearchLanguage, spanishSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    mockedRunSearch
      .mockResolvedValueOnce(
        searchResult("semantic", {
          results: [videoResult("semantic-1")],
          hasMore: true,
          nextOffset: 10,
          resolvedLanguage: {
            locale: "es",
            publicSlug: "spanish-castilian",
            englishName: "Spanish, Castilian",
            source: "route",
          },
        }),
      )
      .mockResolvedValueOnce(
        searchResult("semantic", {
          results: [videoResult("semantic-2")],
          hasMore: false,
          resolvedLanguage: {
            locale: "es",
            publicSlug: "spanish-castilian",
            englishName: "Spanish, Castilian",
            source: "route",
          },
        }),
      )

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    const searchButton = document.querySelector(
      '[data-testid="search-mode-harness-button"]',
    ) as HTMLButtonElement
    const loadMoreButton = document.querySelector(
      '[data-testid="search-mode-harness-load-more-button"]',
    ) as HTMLButtonElement
    const resultCount = document.querySelector(
      '[data-testid="search-result-count"]',
    )

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(resultCount?.textContent).toBe("1")
    expect(mockedRunSearch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        query: "jesus",
        languageEnglishNames: ["Spanish, Castilian"],
        languageSlug: "spanish-castilian",
      }),
    )

    await act(async () => {
      loadMoreButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(resultCount?.textContent).toBe("2")
    expect(mockedRunSearch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        query: "jesus",
        offset: 10,
        languageEnglishNames: ["Spanish, Castilian"],
        languageSlug: "spanish-castilian",
      }),
    )
  })

  it("clears loading state when an in-flight search is reset before it resolves", async () => {
    vi.useFakeTimers()
    mockedRunSearch.mockReturnValueOnce(new Promise(() => {}))

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    const searchButton = document.querySelector(
      '[data-testid="search-mode-harness-button"]',
    ) as HTMLButtonElement
    const clearButton = document.querySelector(
      '[data-testid="search-mode-harness-clear-button"]',
    ) as HTMLButtonElement
    const loading = document.querySelector('[data-testid="search-loading"]')
    const skeleton = document.querySelector('[data-testid="search-skeleton"]')

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(loading?.textContent).toBe("true")
    expect(skeleton?.textContent).toBe("true")

    await act(async () => {
      clearButton.click()
      await Promise.resolve()
    })

    expect(loading?.textContent).toBe("false")
    expect(skeleton?.textContent).toBe("false")
  })

  it("keeps the active loading state when a stale search resolves", async () => {
    vi.useFakeTimers()
    let resolveFirstSearch: (value: SearchActionResult) => void = () => {}
    const firstSearch = new Promise<SearchActionResult>((resolve) => {
      resolveFirstSearch = resolve
    })
    mockedRunSearch
      .mockReturnValueOnce(firstSearch)
      .mockReturnValueOnce(new Promise(() => {}))

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    const searchButton = document.querySelector(
      '[data-testid="search-mode-harness-button"]',
    ) as HTMLButtonElement
    const loading = document.querySelector('[data-testid="search-loading"]')
    const skeleton = document.querySelector('[data-testid="search-skeleton"]')

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      searchButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockedRunSearch).toHaveBeenCalledTimes(2)
    expect(loading?.textContent).toBe("true")
    expect(skeleton?.textContent).toBe("true")

    await act(async () => {
      resolveFirstSearch(searchResult("semantic"))
      await firstSearch
      await Promise.resolve()
    })

    expect(loading?.textContent).toBe("true")
    expect(skeleton?.textContent).toBe("true")
  })

  it("leaves the browser URL unchanged when the submitted search query changes", async () => {
    mockedRunSearch.mockResolvedValueOnce(searchResult("semantic"))
    window.history.replaceState({ next: "initial" }, "", "/watch?utm=campaign")

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    const historyState = { next: "preserve" }
    window.history.replaceState(historyState, "", "/watch?q=bible&utm=campaign")
    const replaceState = vi.spyOn(window.history, "replaceState")

    const searchButton = document.querySelector(
      '[data-testid="search-mode-harness-button"]',
    ) as HTMLButtonElement

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
    })

    expect(window.location.pathname).toBe("/watch")
    expect(window.location.search).toBe("?q=bible&utm=campaign")
    expect(window.history.state).toEqual(historyState)
    expect(replaceState).not.toHaveBeenCalled()
    expect(navigationMocks.replace).not.toHaveBeenCalled()
  })

  it("leaves the browser URL unchanged when search is cleared", async () => {
    window.history.replaceState({ next: "initial" }, "", "/watch?utm=campaign")

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    const historyState = { next: "preserve" }
    window.history.replaceState(historyState, "", "/watch?q=jesus&utm=campaign")
    const replaceState = vi.spyOn(window.history, "replaceState")

    const clearButton = document.querySelector(
      '[data-testid="search-mode-harness-clear-button"]',
    ) as HTMLButtonElement

    await act(async () => {
      clearButton.click()
      await Promise.resolve()
    })

    expect(window.location.pathname).toBe("/watch")
    expect(window.location.search).toBe("?q=jesus&utm=campaign")
    expect(window.history.state).toEqual(historyState)
    expect(replaceState).not.toHaveBeenCalled()
    expect(navigationMocks.replace).not.toHaveBeenCalled()
    expect(mockedRunSearch).not.toHaveBeenCalled()
  })
})

describe("FloatingSearchProvider — watch playback chrome", () => {
  it("hides the floating search bar with the rest of the header chrome", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const searchButton = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    const mobileSearchButton = document.querySelector(
      '[data-testid="floating-search-mobile-button"]',
    )
    expect(searchButton?.className).toContain("opacity-100")
    expect(searchButton?.className).toContain("cursor-text")
    expect(searchButton?.className).not.toContain("cursor-pointer")
    expect(searchButton?.className).toContain("hidden")
    expect(searchButton?.className).toContain("sm:flex")
    expect(searchButton?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+2rem)]",
    )
    expect(searchButton?.className).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(searchButton?.className).toContain("items-center")
    expect(searchButton?.className).toContain("left-4")
    expect(searchButton?.className).toContain("right-44")
    expect(searchButton?.className).toContain("sm:left-36")
    expect(searchButton?.className).toContain("md:right-52")
    expect(searchButton?.className).toContain("xl:right-60")
    expect(searchButton?.className).not.toContain("-translate-x-1/2")
    expect(searchButton?.className).not.toContain("max-w-[810px]")
    expect(searchButton?.className).toContain("hover:bg-white")
    expect(searchButton?.className).toContain("hover:text-stone-950")
    expect(mobileSearchButton).not.toBeNull()
    expect(mobileSearchButton?.className).toContain("sm:hidden")
    expect(mobileSearchButton?.className).toContain("cursor-pointer")
    expect(mobileSearchButton?.className).toContain("right-24")
    expect(mobileSearchButton?.textContent).toBe("")
    expect(
      searchButton?.querySelector('[data-testid="floating-search-icon"]'),
    ).not.toBeNull()
    expect(
      searchButton
        ?.querySelector('[data-testid="floating-search-icon"]')
        ?.getAttribute("class"),
    ).toContain("group-hover:text-stone-950")

    act(() => {
      dispatchChromeVisibility(false)
    })

    expect(searchButton?.className).toContain("opacity-0")
    expect(mobileSearchButton?.className).toContain("opacity-0")

    act(() => {
      dispatchChromeVisibility(true)
    })

    expect(searchButton?.className).toContain("opacity-100")
    expect(mobileSearchButton?.className).toContain("opacity-100")
  })

  it("keeps the floating search bar visible during unmuted playback while the player chrome is up", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchPlaybackState({ playing: true, muted: false })
    })

    const searchButton = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    const mobileSearchButton = document.querySelector(
      '[data-testid="floating-search-mobile-button"]',
    )
    expect(searchButton?.className).toContain("opacity-100")
    expect(mobileSearchButton?.className).toContain("opacity-100")
  })

  it("dims the floating search bar when player chrome publishes 30% opacity", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchChromeVisibility(true, 0.3)
    })

    const searchButton = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    const mobileSearchButton = document.querySelector(
      '[data-testid="floating-search-mobile-button"]',
    )
    expect(searchButton?.className).toContain("opacity-30")
    expect(searchButton?.className).toContain("pointer-events-auto")
    expect(mobileSearchButton?.className).toContain("opacity-30")
    expect(mobileSearchButton?.className).toContain("pointer-events-auto")
  })

  it("keeps the floating search bar dimmed and asks the player to brighten while hovering during player dim state", () => {
    const revealListener = vi.fn()
    window.addEventListener(WATCH_PLAYER_CHROME_REVEAL_EVENT, revealListener)
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchChromeVisibility(true, 0.3)
    })

    const searchButton = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    const mobileSearchButton = document.querySelector(
      '[data-testid="floating-search-mobile-button"]',
    )
    const hoverZone = document.querySelector(
      '[data-testid="floating-header-hover-zone"]',
    )

    act(() => {
      hoverZone?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })

    expect(searchButton?.className).toContain("opacity-30")
    expect(mobileSearchButton?.className).toContain("opacity-30")
    expect(revealListener).toHaveBeenCalled()
    window.removeEventListener(WATCH_PLAYER_CHROME_REVEAL_EVENT, revealListener)
  })

  it("reveals the floating search bar and emits a player reveal request while hovering the header after player chrome hides", () => {
    const revealListener = vi.fn()
    window.addEventListener(WATCH_PLAYER_CHROME_REVEAL_EVENT, revealListener)
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const searchButton = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    const mobileSearchButton = document.querySelector(
      '[data-testid="floating-search-mobile-button"]',
    )
    const hoverZone = document.querySelector(
      '[data-testid="floating-header-hover-zone"]',
    )

    act(() => {
      dispatchChromeVisibility(false)
    })

    expect(searchButton?.className).toContain("opacity-0")
    expect(mobileSearchButton?.className).toContain("opacity-0")
    expect(hoverZone?.className).toContain("pointer-events-auto")

    act(() => {
      hoverZone?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })

    expect(searchButton?.className).toContain("opacity-100")
    expect(mobileSearchButton?.className).toContain("opacity-100")

    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: 200 }))
    })

    expect(searchButton?.className).toContain("opacity-0")
    expect(mobileSearchButton?.className).toContain("opacity-0")
    expect(revealListener).toHaveBeenCalled()
    window.removeEventListener(WATCH_PLAYER_CHROME_REVEAL_EVENT, revealListener)
  })
})

describe("FloatingSearchProvider — language switcher chrome", () => {
  it("renders the language globe as part of the floating header", () => {
    const onLanguageClick = vi.fn()
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchLanguageSwitcher({ visible: true, onClick: onLanguageClick })
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    ) as HTMLButtonElement | null
    expect(languageButton).not.toBeNull()
    expect(languageButton?.className).toContain("fixed")
    expect(languageButton?.className).toContain("right-10")
    expect(languageButton?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+2rem)]",
    )
    expect(languageButton?.className).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(languageButton?.className).toContain("h-[52px]")
    expect(languageButton?.className).toContain("z-50")
    expect(languageButton?.className).toContain("cursor-pointer")
    expect(languageButton?.querySelector("svg")?.className.baseVal).toContain(
      "drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]",
    )
    expect(
      document.querySelector('[data-testid="floating-header-animated-icon"]'),
    ).toBeNull()

    const logo = document.querySelector('[data-testid="floating-header-logo"]')
    expect(logo?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+2rem)]",
    )
    expect(logo?.className).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(logo?.className).toContain("h-[52px]")
    expect(logo?.className).toContain("flex")
    expect(logo?.className).not.toContain("hidden")
    expect(logo?.querySelector("img")?.getAttribute("class")).toContain(
      "max-w-[42px]",
    )
    expect(logo?.querySelector("img")?.getAttribute("src")).toBe(
      "/watch/images/jesusfilm-sign.svg",
    )

    act(() => {
      languageButton?.click()
    })

    expect(onLanguageClick).toHaveBeenCalledTimes(1)
  })

  it("keeps the language globe after the pathname chrome reset frame", () => {
    vi.useFakeTimers()
    const onLanguageClick = vi.fn()
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchLanguageSwitcher({ visible: true, onClick: onLanguageClick })
    })

    expect(
      document.querySelector('[data-testid="floating-header-language-button"]'),
    ).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(20)
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    ) as HTMLButtonElement | null
    expect(languageButton).not.toBeNull()

    act(() => {
      languageButton?.click()
    })
    expect(onLanguageClick).toHaveBeenCalledTimes(1)
  })

  it("hides the floating language globe with the rest of the header chrome", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchLanguageSwitcher({ visible: true, onClick: vi.fn() })
      dispatchChromeVisibility(false)
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    )
    expect(languageButton?.className).toContain("opacity-0")
    expect(
      document.querySelector('[data-testid="floating-header-animated-icon"]'),
    ).toBeNull()
  })

  it("dims the floating language globe and logo with player chrome opacity", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    act(() => {
      dispatchLanguageSwitcher({ visible: true, onClick: vi.fn() })
      dispatchChromeVisibility(true, 0.3)
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    )
    const logo = document.querySelector('[data-testid="floating-header-logo"]')
    expect(languageButton?.className).toContain("opacity-30")
    expect(languageButton?.className).not.toContain("pointer-events-none")
    expect(logo?.className).toContain("opacity-30")
    expect(logo?.className).not.toContain("pointer-events-none")
  })
})

describe("FloatingSearchProvider — search overlay chrome", () => {
  it("does not mount the full search overlay on initial render without query intent", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    expect(
      document.querySelector('[aria-label="Search and browse videos"]'),
    ).toBeNull()
    expect(getSearchLanguageOptions).not.toHaveBeenCalled()
  })

  it("ignores direct query URLs on initial render", async () => {
    window.history.replaceState(null, "", "/?q=jesus")

    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })
    await flushSearchControllerMount()

    expect(
      document.querySelector('[aria-label="Search and browse videos"]'),
    ).toBeNull()
    expect(runSearch).not.toHaveBeenCalled()
    expect(getSearchLanguageOptions).not.toHaveBeenCalled()
    expect(navigationMocks.replace).not.toHaveBeenCalled()
  })

  it("aligns the search overlay close button with the watch modal close control", async () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const searchButton = document.querySelector(
      '[aria-label="Search videos"]',
    ) as HTMLButtonElement
    await act(async () => {
      searchButton.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushSearchControllerMount()

    const close = document.querySelector(
      '[data-testid="search-overlay-close"]',
    ) as HTMLButtonElement | null
    const pageWrapper = document.querySelector("[inert]")
    const topBar = document.querySelector(
      '[data-testid="search-overlay-top-bar"]',
    )
    const overlay = document.querySelector(
      '[aria-label="Search and browse videos"]',
    )
    const overlayField = document.querySelector('[role="search"]')
    const mobileLogo = document.querySelector(
      '[data-testid="search-overlay-top-bar"] a[aria-label="JesusFilm home"]',
    )
    const mobileLogoImage = mobileLogo?.querySelector("img")
    const bottomBackdrop = document.querySelector(
      '[data-testid="search-overlay-bottom-backdrop"]',
    )
    const scrollBody = document.querySelector(".search-overlay-scroll")
    expect(close).not.toBeNull()
    expect(pageWrapper?.className).toContain("blur-[12px]")
    expect(pageWrapper?.className).not.toContain("brightness-50")
    expect(overlay?.contains(close)).toBe(true)
    expect(overlay?.className).toContain("h-dvh")
    expect(overlay?.className).toContain("min-h-dvh")
    expect(topBar?.className).toContain("pt-6")
    expect(topBar?.className).toContain("sm:pt-12")
    expect(mobileLogo?.className).toContain("mb-6")
    expect(mobileLogo?.className).not.toContain("absolute")
    expect(mobileLogoImage?.getAttribute("src")).toBe(
      "/watch/images/jesusfilm-sign.svg",
    )
    expect(bottomBackdrop).not.toBeNull()
    expect(bottomBackdrop?.className).toContain("absolute")
    expect(bottomBackdrop?.className).toContain("bottom-[-14rem]")
    expect(bottomBackdrop?.className).toContain("bg-black/85")
    expect(bottomBackdrop?.className).toContain("backdrop-blur-[14px]")
    expect(scrollBody?.className).toContain("z-1")
    expect(scrollBody?.className).toContain("top-44")
    expect(scrollBody?.className).toContain("sm:top-32")
    expect(scrollBody?.className).toContain("bottom-0")
    expect(overlayField).not.toBeNull()
    expect(overlayField?.className).toContain("rounded-[35px]")
    expect(overlayField?.className).toContain("bg-white")
    expect(
      document.querySelector('[data-testid="search-overlay-input-icon"]'),
    ).not.toBeNull()
    expect(close?.className).toContain("fixed")
    expect(close?.className).toContain("top-6")
    expect(close?.className).toContain("right-4")
    expect(close?.className).toContain("sm:top-12")
    expect(close?.className).toContain("sm:right-10")
    expect(close?.className).toContain("h-[52px]")
    expect(close?.className).toContain("w-12")
    expect(close?.className).toContain("z-[60]")
    expect(close?.querySelector("svg")?.getAttribute("class")).toContain("h-6")
    expect(close?.querySelector("svg")?.getAttribute("class")).toContain("w-6")
  })
})

describe("FloatingSearchProvider — search pagination", () => {
  it("requests the initial Watch search page with limit 10 and offset 0", async () => {
    vi.useFakeTimers()
    mockedRunSearch.mockResolvedValueOnce(
      makeSearchResponse(
        [makeSearchResult("first-result", "The Bible Project Result")],
        false,
      ),
    )

    const input = await openSearchOverlay()
    await submitDebouncedSearch(input, "the bible project")

    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "the bible project",
        limit: 10,
        offset: 0,
      }),
    )
    expect(document.body.textContent).toContain("The Bible Project Result")
  })

  it("keeps the final edited query search without syncing the URL", async () => {
    vi.useFakeTimers()
    window.history.replaceState(null, "", "/watch?utm=campaign")
    mockedRunSearch.mockImplementation(({ query }) => {
      if (query === "jesus") {
        return Promise.resolve(
          makeSearchResponse(
            [makeSearchResult("jesus", "Jesus Result")],
            false,
          ),
        )
      }
      if (query === "the bible project") {
        return Promise.resolve(
          makeSearchResponse(
            [makeSearchResult("bible-project", "Bible Project Result")],
            false,
          ),
        )
      }
      return new Promise(() => {})
    })

    try {
      const replaceState = vi.spyOn(window.history, "replaceState")
      const input = await openSearchOverlay()
      await submitDebouncedSearch(input, "jesus")
      expect(document.body.textContent).toContain("Jesus Result")

      act(() => {
        setInputValue(input, "the bible proj")
        vi.advanceTimersByTime(360)
      })

      expect(window.location.search).toBe("?utm=campaign")

      await act(async () => {
        setInputValue(input, "the bible project")
        vi.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => {
        vi.advanceTimersByTime(250)
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mockedRunSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: "the bible project" }),
      )
      expect(window.location.search).toBe("?utm=campaign")
      expect(replaceState).not.toHaveBeenCalled()
      expect(navigationMocks.replace).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain("Bible Project Result")
      expect(document.querySelector(".animate-pulse")).toBeNull()
    } finally {
      mockedRunSearch.mockReset()
    }
  })

  it("loads the next Watch search page with limit 10, current offset, and appends results", async () => {
    vi.useFakeTimers()
    const initialResults = Array.from({ length: 7 }, (_, index) =>
      makeSearchResult(
        `initial-${index + 1}`,
        `Initial Bible Project Result ${index + 1}`,
      ),
    )
    const nextResults = [
      makeSearchResult("next-1", "Next Bible Project Result 1"),
    ]
    mockedRunSearch
      .mockResolvedValueOnce(makeSearchResponse(initialResults, true))
      .mockResolvedValueOnce(makeSearchResponse(nextResults, false))

    const input = await openSearchOverlay()
    await submitDebouncedSearch(input, "the bible project")

    const loadMore = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Load more",
    )
    expect(loadMore).not.toBeUndefined()

    act(() => {
      loadMore?.click()
    })
    await flushResolvedSearch()

    expect(mockedRunSearch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        query: "the bible project",
        limit: 10,
        offset: 0,
      }),
    )
    expect(mockedRunSearch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        query: "the bible project",
        limit: 10,
        offset: 7,
      }),
    )
    expect(document.body.textContent).toContain(
      "Initial Bible Project Result 1",
    )
    expect(document.body.textContent).toContain("Next Bible Project Result 1")
  })
})
