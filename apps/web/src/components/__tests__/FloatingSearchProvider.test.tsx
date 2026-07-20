/**
 * @vitest-environment jsdom
 */
import { act, useEffect, useState, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  FloatingSearchController,
  resetSearchLanguageOptionsCacheForTest,
} from "@/components/FloatingSearchController"
import {
  FloatingSearchProvider,
  useFloatingSearch,
} from "@/components/FloatingSearchProvider"
import {
  FLOATING_HEADER_LANGUAGE_SLOT_CLASS,
  FLOATING_HEADER_PINNED_TOP_CLASS,
  FLOATING_HEADER_TOP_CLASS,
  FLOATING_HEADER_TRAILING_SLOT_CLASS,
  FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS,
  FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS,
  FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS,
  FLOATING_MODAL_HEADER_LAYOUT_CLASS,
  FLOATING_MODAL_HEADER_LOGO_POSITION_CLASS,
  FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS,
  WATCH_PAGE_LEFT_EDGE_CLASSES,
  WATCH_PAGE_RIGHT_EDGE_CLASSES,
} from "@/lib/content-width"
import {
  recordWatchSearchResultClick,
  recordWatchSearchResultsViewed,
  runSearch,
} from "@/lib/search-actions"
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
import { WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION } from "@/lib/watch-search-analytics-contract"

const navigationMocks = vi.hoisted(() => ({
  pathname: "/",
  replace: vi.fn(),
}))
const { clearDatadogRumUser, identifyDatadogRumUser, reportDatadogRumAction } =
  vi.hoisted(() => ({
    clearDatadogRumUser: vi.fn(),
    identifyDatadogRumUser: vi.fn(),
    reportDatadogRumAction: vi.fn(),
  }))

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
  useRouter: () => ({
    replace: navigationMocks.replace,
  }),
}))

vi.mock("@/lib/search-actions", () => ({
  recordWatchSearchResultClick: vi.fn(async () => ({ ok: true })),
  recordWatchSearchResultsViewed: vi.fn(async () => ({ ok: true })),
  runSearch: vi.fn(),
}))

vi.mock("@/lib/search-language-actions", () => ({
  getSearchLanguageOptions: vi.fn(async () => ({
    ok: true,
    options: [],
    countrySuggestion: null,
    recommendedLanguage: null,
    countryCode: null,
    countryName: null,
  })),
}))

vi.mock("@/components/DatadogRum", () => ({
  clearDatadogRumUser,
  default: () => null,
  identifyDatadogRumUser,
  reportDatadogRumAction,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  resetSearchLanguageOptionsCacheForTest()
  navigationMocks.pathname = "/"
  setScrollY(0)
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

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value,
  })
}

async function dispatchScrollAndFlush() {
  await act(async () => {
    window.dispatchEvent(new Event("scroll"))
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  })
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
  imageBlurDataUrl: null,
  muxThumbnailBlurDataUrl: null,
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
    imageBlurDataUrl: null,
    muxThumbnailBlurDataUrl: null,
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
  return searchResult("watch-search", {
    results,
    hasMore,
    query: "the bible project",
    searchMode: "watch-search",
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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
      "h-[calc(4.75rem+env(safe-area-inset-top,0px))]",
    )
    expect(backdrop?.className).toContain(
      "md:h-[calc(8rem+env(safe-area-inset-top,0px))]",
    )
    expect(backdrop?.className).toContain("backdrop-blur-[14px]")
    expect(backdrop?.className).toContain("bg-[linear-gradient")
    expect(backdrop?.className).toContain("opacity-100")
  })

  it("uses safe-area-aware compact geometry in short phone landscape", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const compactLandscape = "compact-landscape"
    const header = document.querySelector('[data-testid="floating-header"]')
    const backdrop = document.querySelector(
      '[data-testid="floating-header-backdrop"]',
    )
    const hoverZone = document.querySelector(
      '[data-testid="floating-header-hover-zone"]',
    )

    expect(FLOATING_HEADER_TOP_CLASS).toContain(
      `${compactLandscape}:top-[calc(env(safe-area-inset-top,0px)+0.5rem)]`,
    )
    expect(FLOATING_HEADER_PINNED_TOP_CLASS).toContain(
      `${compactLandscape}:top-[calc(env(safe-area-inset-top,0px)+0.5rem)]`,
    )
    expect(WATCH_PAGE_LEFT_EDGE_CLASSES).toContain(
      `${compactLandscape}:left-[max(1.25rem,env(safe-area-inset-left,0px))]`,
    )
    expect(WATCH_PAGE_RIGHT_EDGE_CLASSES).toContain(
      `${compactLandscape}:right-[max(1.25rem,env(safe-area-inset-right,0px))]`,
    )
    expect(header?.className).toContain(FLOATING_HEADER_TOP_CLASS)
    expect(backdrop?.className).toContain(
      `${compactLandscape}:h-[calc(4.25rem+env(safe-area-inset-top,0px))]`,
    )
    expect(hoverZone?.className).toContain(
      `${compactLandscape}:h-[calc(4.25rem+env(safe-area-inset-top,0px))]`,
    )
  })

  it("moves the desktop gradient upward in compact header mode", () => {
    setScrollY(100)
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const backdrop = document.querySelector(
      '[data-testid="floating-header-backdrop"]',
    )
    expect(backdrop?.className).toContain("bg-black/72")
    expect(backdrop?.className).toContain("md:bg-[linear-gradient")
    expect(backdrop?.className).toContain("md:shadow-none")
    expect(backdrop?.className).toContain("md:backdrop-blur-none")
    expect(backdrop?.className).toContain("md:-translate-y-[72%]")
  })

  it("keeps the frosted header backdrop outside preview mode", () => {
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

    expect(backdrop?.className).toContain("opacity-100")
  })
})

describe("FloatingSearchProvider — search mode", () => {
  it("keeps the resolved semantic language when loading more after metadata refresh", async () => {
    navigationMocks.pathname = "/jesus.html/spanish-castilian.html"
    mockedGetSearchLanguageOptions.mockResolvedValueOnce({
      ok: true,
      options: [englishSearchLanguage, spanishSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    mockedRunSearch
      .mockResolvedValueOnce(
        searchResult("watch-search", {
          results: [videoResult("watch-search-1")],
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
        searchResult("watch-search", {
          results: [videoResult("watch-search-1")],
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
        languageEnglishNames: [],
        languageSlug: null,
        languageSlugIsExplicit: false,
        routeLanguageSlug: "spanish-castilian",
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
        languageEnglishNames: [],
        languageSlug: null,
        languageSlugIsExplicit: false,
        routeLanguageSlug: "spanish-castilian",
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
      resolveFirstSearch(searchResult("watch-search"))
      await firstSearch
      await Promise.resolve()
    })

    expect(loading?.textContent).toBe("true")
    expect(skeleton?.textContent).toBe("true")
  })

  it("leaves the browser URL unchanged when the submitted search query changes", async () => {
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))
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
    const header = document.querySelector('[data-testid="floating-header"]')
    const mobileSearchButton = document.querySelector(
      '[data-testid="floating-search-mobile-button"]',
    )
    expect(mobileSearchButton).toBeNull()
    expect(header?.className).toContain("fixed")
    expect(header?.className).toContain("left-5")
    expect(header?.className).toContain("right-5")
    expect(header?.className).toContain(
      "xl:left-[max(6rem,calc((100vw-1920px)/2+6rem))]",
    )
    expect(header?.className).toContain(
      "xl:right-[max(6rem,calc((100vw-1920px)/2+6rem))]",
    )
    expect(header?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+0.75rem)]",
    )
    expect(header?.className).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(header?.className).toContain("h-[52px]")
    expect(header?.className).toContain("items-center")
    expect(header?.className).toContain("gap-3")
    expect(header?.className).toContain("translate-y-0")
    expect(searchButton?.className).toContain("opacity-100")
    expect(searchButton?.className).toContain("cursor-text")
    expect(searchButton?.className).not.toContain("cursor-pointer")
    expect(searchButton?.className).toContain("flex")
    expect(searchButton?.className).not.toContain("hidden")
    expect(searchButton?.className).not.toContain("sm:flex")
    expect(searchButton?.className).toContain("items-center")
    expect(searchButton?.className).toContain("w-full")
    expect(searchButton?.className).not.toContain("fixed")
    expect(searchButton?.className).not.toContain("right-44")
    expect(searchButton?.className).not.toContain("md:right-52")
    expect(searchButton?.className).toContain("hover:bg-white")
    expect(searchButton?.className).toContain("hover:text-stone-950")
    const searchLabels = searchButton?.querySelectorAll("span")
    expect(searchLabels?.[0]?.textContent).toBe("Search")
    expect(searchLabels?.[0]?.className).toContain("md:hidden")
    expect(searchLabels?.[1]?.textContent).toBe("Search or browse topics…")
    expect(searchLabels?.[1]?.className).toContain("hidden md:inline")
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
    expect(header?.className).toContain("-translate-y-[calc(100%+2rem)]")

    act(() => {
      dispatchChromeVisibility(true)
    })

    expect(searchButton?.className).toContain("opacity-100")
    expect(header?.className).toContain("translate-y-0")
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
    expect(mobileSearchButton).toBeNull()
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
    expect(mobileSearchButton).toBeNull()
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
    expect(mobileSearchButton).toBeNull()
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
    expect(mobileSearchButton).toBeNull()
    expect(hoverZone?.className).toContain("pointer-events-auto")

    act(() => {
      hoverZone?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })

    expect(searchButton?.className).toContain("opacity-100")

    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: 200 }))
    })

    expect(searchButton?.className).toContain("opacity-0")
    expect(revealListener).toHaveBeenCalled()
    window.removeEventListener(WATCH_PLAYER_CHROME_REVEAL_EVENT, revealListener)
  })

  it("slides the header away after scrolling past the hero and restores it when scrolling up", async () => {
    setScrollY(0)
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>
            <section data-testid="hero-player-wrapper">Hero</section>
          </main>
        </FloatingSearchProvider>,
      )
    })

    const hero = document.querySelector(
      '[data-testid="hero-player-wrapper"]',
    ) as HTMLElement
    Object.defineProperty(hero, "offsetTop", { configurable: true, value: 0 })
    Object.defineProperty(hero, "offsetHeight", {
      configurable: true,
      value: 600,
    })

    const header = document.querySelector('[data-testid="floating-header"]')
    expect(header?.className).toContain("translate-y-0")
    await dispatchScrollAndFlush()

    setScrollY(700)
    await dispatchScrollAndFlush()

    expect(header?.className).toContain("opacity-100")
    expect(header?.className).toContain("-translate-y-[calc(100%+2rem)]")
    expect(
      document.querySelector('[data-testid="floating-header-backdrop"]')
        ?.className,
    ).toContain("-translate-y-[calc(100%+2rem)]")

    setScrollY(650)
    await dispatchScrollAndFlush()

    expect(header?.className).toContain("opacity-100")
    expect(header?.className).toContain("translate-y-0")
  })
})

describe("FloatingSearchProvider — language switcher chrome", () => {
  it("renders the full ministry logo on Watch home routes", async () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const logo = document.querySelector('[data-testid="floating-header-logo"]')
    expect(logo?.getAttribute("href")).toBe("https://www.jesusfilm.org/")
    expect(logo?.className).toContain("w-20")
    expect(logo?.className).toContain("md:w-[139px]")
    expect(logo?.querySelector("img")?.getAttribute("src")).toBe(
      "/watch/images/jesus-film-logo-full.svg",
    )
    expect(logo?.querySelector("img")?.getAttribute("width")).toBe("139")
    expect(logo?.querySelector("img")?.getAttribute("height")).toBe("36")

    navigationMocks.pathname = "/english.html"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Localized page</main>
        </FloatingSearchProvider>,
      )
    })

    expect(logo?.getAttribute("href")).toBe("https://www.jesusfilm.org/")
    expect(logo?.querySelector("img")?.getAttribute("src")).toBe(
      "/watch/images/jesus-film-logo-full.svg",
    )

    await openSearchOverlay()
    const overlayLogoSlot = document.querySelector(
      '[data-testid="search-overlay-top-bar"] > [aria-hidden="true"]',
    )
    expect(overlayLogoSlot?.className).toContain("w-20")
    expect(overlayLogoSlot?.className).toContain("md:w-[139px]")
  })

  it("keeps the compact logo on inner Watch routes", () => {
    navigationMocks.pathname = "/jesus.html/english.html"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Video page</main>
        </FloatingSearchProvider>,
      )
    })

    const logo = document.querySelector('[data-testid="floating-header-logo"]')
    // Next applies the configured `/watch` base path at runtime; jsdom exposes
    // the base-path-relative route passed to `next/link`.
    expect(logo?.getAttribute("href")).toBe("/")
    expect(logo?.className).toContain("w-11")
    expect(logo?.className).toContain("md:w-12")
    expect(logo?.querySelector("img")?.getAttribute("src")).toBe(
      "/watch/images/jesusfilm-sign.svg",
    )
    expect(logo?.querySelector("img")?.getAttribute("class")).toContain(
      "max-w-[38px]",
    )
  })

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
      dispatchLanguageSwitcher({
        visible: true,
        onClick: onLanguageClick,
        languageCode: "EN",
      })
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    ) as HTMLButtonElement | null
    const header = document.querySelector('[data-testid="floating-header"]')
    expect(languageButton).not.toBeNull()
    expect(
      languageButton?.querySelector(
        '[data-testid="floating-header-language-code"]',
      )?.textContent,
    ).toBe("EN")
    expect(header?.className).toContain("fixed")
    expect(header?.className).toContain("right-5")
    expect(header?.className).toContain(
      "xl:right-[max(6rem,calc((100vw-1920px)/2+6rem))]",
    )
    expect(header?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+0.75rem)]",
    )
    expect(header?.className).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(languageButton?.className).toContain("h-11")
    expect(languageButton?.className).toContain("w-11")
    expect(languageButton?.className).toContain("md:h-[52px]")
    expect(languageButton?.className).toContain("md:w-12")
    expect(header?.className).toContain("z-50")
    expect(languageButton?.className).toContain("cursor-pointer")
    expect(languageButton?.querySelector("svg")?.className.baseVal).toContain(
      "drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.35)]",
    )
    expect(
      document.querySelector('[data-testid="floating-header-animated-icon"]'),
    ).toBeNull()

    const logo = document.querySelector('[data-testid="floating-header-logo"]')
    expect(header?.className).toContain("left-5")
    expect(header?.className).toContain(
      "xl:left-[max(6rem,calc((100vw-1920px)/2+6rem))]",
    )
    expect(logo?.className).toContain("h-11")
    expect(logo?.className).toContain("md:h-[52px]")
    expect(logo?.className).toContain("flex")
    expect(logo?.className).not.toContain("hidden")

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
    const header = document.querySelector('[data-testid="floating-header"]')
    expect(header?.className).toContain("opacity-0")
    expect(header?.className).toContain("-translate-y-[calc(100%+2rem)]")
    expect(languageButton).not.toBeNull()
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
    const header = document.querySelector('[data-testid="floating-header"]')
    expect(header?.className).toContain("opacity-30")
    expect(header?.className).not.toContain("pointer-events-none")
    expect(languageButton).not.toBeNull()
    expect(logo).not.toBeNull()
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

  it("renders the search input shell immediately while the full controller loads", async () => {
    type LanguageOptionsResponse = Awaited<
      ReturnType<typeof getSearchLanguageOptions>
    >
    const delayedLanguageOptions = deferred<LanguageOptionsResponse>()
    mockedGetSearchLanguageOptions.mockReturnValueOnce(
      delayedLanguageOptions.promise,
    )

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
    })

    expect(
      document.querySelector('input[aria-label="Search videos by keyword"]'),
    ).not.toBeNull()
    const overlayTopBar = document.querySelector(
      '[data-testid="search-overlay-instant-top-bar"], [data-testid="search-overlay-top-bar"]',
    )
    const overlayFieldShell = document.querySelector(
      '[data-testid="search-overlay-instant-field-shell"], [data-testid="search-overlay-field-shell"]',
    )
    const header = document.querySelector('[data-testid="floating-header"]')
    const close = document.querySelector(
      '[data-testid="floating-header-search-close"]',
    )
    expect(overlayTopBar?.className).toContain("left-5")
    expect(overlayTopBar?.className).toContain("right-5")
    expect(overlayTopBar?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+0.75rem)]",
    )
    expect(overlayTopBar?.className).toContain(
      FLOATING_MODAL_HEADER_LAYOUT_CLASS,
    )
    expect(overlayFieldShell?.className).toContain(
      FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS,
    )
    expect(overlayFieldShell?.className).toContain("col-span-2")
    expect(header?.className).toContain(FLOATING_MODAL_HEADER_LAYOUT_CLASS)
    expect(header?.className).toContain("translate-y-0")
    expect(close?.className).toContain(
      FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS,
    )
    expect(
      document.querySelector('[data-testid="floating-header-search-close"]'),
    ).not.toBeNull()
    expect(
      document.querySelector('[data-testid="search-overlay-instant-close"]'),
    ).toBeNull()
    expect(mockedGetSearchLanguageOptions).toHaveBeenCalledTimes(1)

    await act(async () => {
      delayedLanguageOptions.resolve({
        ok: true,
        options: [],
        countrySuggestion: null,
        recommendedLanguage: null,
        countryCode: null,
        countryName: null,
      })
      await delayedLanguageOptions.promise
      await Promise.resolve()
    })
  })

  it("reuses language metadata when reopening the search modal", async () => {
    mockedGetSearchLanguageOptions.mockResolvedValue({
      ok: true,
      options: [englishSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })

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

    expect(mockedGetSearchLanguageOptions).toHaveBeenCalledTimes(1)

    const firstInput = document.querySelector(
      'input[aria-label="Search videos by keyword"]',
    ) as HTMLInputElement
    act(() => {
      setInputValue(firstInput, "jesus")
    })
    expect(firstInput.value).toBe("jesus")

    const close = document.querySelector(
      '[data-testid="floating-header-search-close"]',
    ) as HTMLButtonElement | null
    await act(async () => {
      close?.click()
      await new Promise((resolve) => setTimeout(resolve, 220))
    })

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
    })

    const reopenedInput = document.querySelector(
      'input[aria-label="Search videos by keyword"]',
    ) as HTMLInputElement | null
    expect(reopenedInput?.value).toBe("")
    expect(
      document.querySelector(
        '[data-testid="search-overlay-category-bible-stories"]',
      ),
    ).not.toBeNull()
    expect(mockedGetSearchLanguageOptions).toHaveBeenCalledTimes(1)
  })

  it("resets the search field when Escape closes the modal", async () => {
    const input = await openSearchOverlay()
    act(() => {
      setInputValue(input, "jesus")
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220))
    })

    const searchButton = document.querySelector(
      '[aria-label="Search videos"]',
    ) as HTMLButtonElement
    await act(async () => {
      searchButton.click()
      await Promise.resolve()
    })

    const reopenedInput = document.querySelector(
      'input[aria-label="Search videos by keyword"]',
    ) as HTMLInputElement | null
    expect(reopenedInput?.value).toBe("")
  })

  it("ignores an in-flight search response after the modal closes", async () => {
    vi.useFakeTimers()
    const delayedSearch = deferred<SearchActionResult>()
    mockedRunSearch.mockReturnValueOnce(delayedSearch.promise)

    const input = await openSearchOverlay()
    await submitDebouncedSearch(input, "jesus")

    const close = document.querySelector(
      '[data-testid="floating-header-search-close"]',
    ) as HTMLButtonElement
    await act(async () => {
      close.click()
      await Promise.resolve()
    })
    expect(input.value).toBe("")

    await act(async () => {
      delayedSearch.resolve(
        makeSearchResponse([makeSearchResult("late", "Late Result")], false),
      )
      await delayedSearch.promise
      await Promise.resolve()
      vi.advanceTimersByTime(220)
    })

    expect(document.body.textContent).not.toContain("Late Result")
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

  it("focuses the modal search input when the floating field opens", async () => {
    vi.useFakeTimers()

    const input = await openSearchOverlay()

    expect(document.activeElement).toBe(input)

    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })

    expect(document.activeElement).toBe(input)
  })

  it("keeps focus on the modal search input after language controls render", async () => {
    vi.useFakeTimers()
    mockedGetSearchLanguageOptions.mockResolvedValueOnce({
      ok: true,
      options: [englishSearchLanguage, spanishSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })

    const input = await openSearchOverlay()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })

    expect(
      document.querySelector('[data-testid="language-combobox-trigger"]'),
    ).not.toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it("keeps the floating header stable while rendering search overlay controls below it", async () => {
    const onLanguageClick = vi.fn()
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
    act(() => {
      dispatchLanguageSwitcher({ visible: true, onClick: onLanguageClick })
    })

    const searchButton = document.querySelector(
      '[aria-label="Search videos"]',
    ) as HTMLButtonElement
    const headerBeforeOpen = document.querySelector(
      '[data-testid="floating-header"]',
    )
    const searchButtonBeforeOpen = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    expect(headerBeforeOpen?.className).toContain("translate-y-0")
    expect(headerBeforeOpen?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+0.75rem)]",
    )
    expect(searchButtonBeforeOpen?.className).toContain("opacity-100")

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushSearchControllerMount()

    const close = document.querySelector(
      '[data-testid="floating-header-search-close"]',
    ) as HTMLButtonElement | null
    const pageWrapper = document.querySelector("[inert]")
    const topBar = document.querySelector(
      '[data-testid="search-overlay-top-bar"]',
    )
    const header = document.querySelector('[data-testid="floating-header"]')
    const hiddenSearchButton = document.querySelector(
      '[data-testid="floating-search-desktop-button"]',
    )
    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    )
    const logo = document.querySelector('[data-testid="floating-header-logo"]')
    const headerTrailingControls = document.querySelector(
      '[data-testid="floating-header-trailing-controls"]',
    )
    const overlay = document.querySelector(
      '[aria-label="Search and browse videos"]',
    ) as HTMLElement | null
    const overlayField = document.querySelector('[role="search"]')
    const overlayFieldShell = document.querySelector(
      '[data-testid="search-overlay-field-shell"]',
    )
    const bottomBackdrop = document.querySelector(
      '[data-testid="search-overlay-bottom-backdrop"]',
    )
    const scrollBody = document.querySelector(".search-overlay-scroll")
    expect(close).not.toBeNull()
    expect(languageButton).not.toBeNull()
    expect(
      document.querySelector('[data-testid="watch-account-control"]'),
    ).toBeNull()
    expect(
      document.querySelector('[data-testid="search-overlay-close"]'),
    ).toBeNull()
    expect(pageWrapper?.className).toContain("blur-[12px]")
    expect(pageWrapper?.className).not.toContain("brightness-50")
    expect(overlay?.contains(close)).toBe(false)
    expect(overlay?.className).toContain("h-dvh")
    expect(overlay?.className).toContain("min-h-dvh")
    expect(overlay?.style.zIndex).toBe("45")
    expect(header?.className).toContain("z-50")
    expect(header?.className).toContain(FLOATING_MODAL_HEADER_LAYOUT_CLASS)
    expect(header?.className).toContain("translate-y-0")
    expect(header?.className).toContain("opacity-100")
    expect(header?.className).not.toContain("-translate-y-[calc(100%+2rem)]")
    expect(hiddenSearchButton?.className).toContain("opacity-0")
    expect(hiddenSearchButton?.className).toContain("pointer-events-none")
    expect(topBar?.className).toContain("left-5")
    expect(topBar?.className).toContain("right-5")
    expect(topBar?.className).toContain(
      "xl:left-[max(6rem,calc((100vw-1920px)/2+6rem))]",
    )
    expect(topBar?.className).toContain(
      "xl:right-[max(6rem,calc((100vw-1920px)/2+6rem))]",
    )
    expect(topBar?.className).toContain(
      "top-[calc(env(safe-area-inset-top,0px)+0.75rem)]",
    )
    expect(topBar?.className).toContain(
      "md:top-[calc(env(safe-area-inset-top,0px)+3rem)]",
    )
    expect(topBar?.className).toContain("gap-3")
    expect(topBar?.className).toContain("md:gap-5")
    expect(topBar?.className).not.toContain(
      "pt-[calc(env(safe-area-inset-top,0px)+2rem)]",
    )
    expect(topBar?.className).not.toContain("sm:pt-12")
    expect(topBar?.className).toContain("md:left-16")
    expect(topBar?.className).toContain("md:right-16")
    expect(topBar?.className).toContain(FLOATING_HEADER_TOP_CLASS)
    expect(topBar?.className).toContain(FLOATING_MODAL_HEADER_LAYOUT_CLASS)
    expect(topBar?.className).toContain("items-start")
    expect(topBar?.className).not.toContain("items-center")
    expect(
      document.querySelector(
        '[data-testid="search-overlay-top-bar"] a[aria-label="JesusFilm home"]',
      ),
    ).toBeNull()
    expect(bottomBackdrop).not.toBeNull()
    expect(bottomBackdrop?.className).toContain("absolute")
    expect(bottomBackdrop?.className).toContain("bottom-[-14rem]")
    expect(bottomBackdrop?.className).toContain("bg-black/85")
    expect(bottomBackdrop?.className).toContain("backdrop-blur-[14px]")
    expect(scrollBody?.className).toContain("z-1")
    expect(scrollBody?.className).toContain("top-44")
    expect(scrollBody?.className).toContain("md:top-32")
    expect(scrollBody?.className).toContain("bottom-0")
    expect(overlayField).not.toBeNull()
    expect(overlayFieldShell?.className).toContain("min-w-0")
    expect(overlayFieldShell?.className).toContain("flex-1")
    expect(overlayFieldShell?.className).toContain(
      FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS,
    )
    expect(overlayFieldShell?.className).not.toContain("col-span-2")
    expect(logo?.className).toContain(FLOATING_MODAL_HEADER_LOGO_POSITION_CLASS)
    expect(languageButton?.className).toContain(
      FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS,
    )
    expect(close?.className).toContain(
      FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS,
    )
    expect(headerTrailingControls?.className).toContain(
      FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS,
    )
    expect(overlayField?.className).toContain("rounded-[35px]")
    expect(overlayField?.className).toContain("bg-white")
    expect(overlayField?.className).toContain("w-full")
    expect(overlayField?.className).not.toContain("md:rounded-r-none")
    expect(
      document.querySelector('[data-testid="search-overlay-input-icon"]'),
    ).not.toBeNull()
    expect(close?.className).toContain("h-11")
    expect(close?.className).toContain("w-11")
    expect(close?.className).toContain("md:h-[52px]")
    expect(close?.className).toContain("md:w-12")
    expect(close?.querySelector("svg")?.getAttribute("class")).toContain("h-6")
    expect(close?.querySelector("svg")?.getAttribute("class")).toContain("w-6")
  })

  it("uses the pinned header top offset when opened from scrolled desktop chrome", async () => {
    setScrollY(100)
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })
    await dispatchScrollAndFlush()

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

    const topBar = document.querySelector(
      '[data-testid="search-overlay-top-bar"]',
    )

    expect(topBar?.className).toContain(FLOATING_HEADER_PINNED_TOP_CLASS)
  })

  it("mirrors the optional header language switcher trailing slot", async () => {
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

    act(() => {
      dispatchLanguageSwitcher({ visible: true, onClick: vi.fn() })
    })

    const headerTrailingControls = document.querySelector(
      '[data-testid="floating-header-trailing-controls"]',
    )
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

    const overlayTrailingSpacer = document.querySelector(
      '[data-testid="search-overlay-trailing-controls-spacer"]',
    )

    expect(headerTrailingControls?.className).toContain(
      FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS,
    )
    expect(overlayTrailingSpacer?.className).toContain(
      FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS,
    )
    expect(overlayTrailingSpacer?.children).toHaveLength(2)
    expect(overlayTrailingSpacer?.children[0]?.className).toContain(
      FLOATING_HEADER_LANGUAGE_SLOT_CLASS,
    )
    expect(overlayTrailingSpacer?.children[0]?.className).toContain(
      FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS,
    )
    expect(overlayTrailingSpacer?.children[1]?.className).toContain(
      FLOATING_HEADER_TRAILING_SLOT_CLASS,
    )
    expect(overlayTrailingSpacer?.children[1]?.className).toContain(
      FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS,
    )
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

  it("reports Datadog RUM context when a Watch search result is clicked", async () => {
    vi.useFakeTimers()
    mockedRunSearch.mockResolvedValueOnce(
      makeSearchResponse(
        [makeSearchResult("first-result", "The Bible Project Result")],
        false,
      ),
    )

    const input = await openSearchOverlay()
    await submitDebouncedSearch(input, "the bible project")

    const link = Array.from(document.querySelectorAll("a")).find(
      (anchor) =>
        anchor.getAttribute("href") === "/first-result-slug.html/english.html",
    )
    const searchRequestId =
      mockedRunSearch.mock.calls[0]?.[0].analytics?.searchRequestId

    expect(recordWatchSearchResultsViewed).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: searchRequestId,
        visibleResultIds: ["first-result"],
      }),
    )
    expect(recordWatchSearchResultsViewed).toHaveBeenCalledTimes(1)

    expect(link).not.toBeUndefined()
    await act(async () => {
      link?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      )
      link?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      )
      await Promise.resolve()
    })

    expect(input.value).toBe("")

    expect(reportDatadogRumAction).toHaveBeenCalledWith(
      WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION,
      expect.objectContaining({
        "watch_search.result_id": "first-result",
        "watch_search.result_position": 1,
        "watch_search.result_slug": "first-result-slug",
        "watch_search.result_source": "watch-search",
        "watch_search.search_request_id": searchRequestId,
      }),
    )
    expect(recordWatchSearchResultClick).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: searchRequestId,
        resultId: "first-result",
        resultType: "video",
        position: 1,
        visibleResultIds: ["first-result"],
      }),
    )
    expect(recordWatchSearchResultClick).toHaveBeenCalledTimes(1)
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

  it("continues pagination after delayed language metadata refreshes the default selection", async () => {
    vi.useFakeTimers()
    const languageMetadata =
      deferred<Awaited<ReturnType<typeof getSearchLanguageOptions>>>()
    mockedGetSearchLanguageOptions.mockReturnValue(languageMetadata.promise)
    mockedRunSearch
      .mockResolvedValueOnce(
        searchResult("watch-search", {
          results: [videoResult("watch-search-1")],
          hasMore: true,
          nextOffset: 10,
          resolvedLanguage: {
            locale: "en",
            publicSlug: "english",
            englishName: "English",
            source: "fallback",
          },
        }),
      )
      .mockResolvedValueOnce(
        searchResult("watch-search", {
          results: [videoResult("watch-search-1")],
          hasMore: false,
          resolvedLanguage: {
            locale: "en",
            publicSlug: "english",
            englishName: "English",
            source: "fallback",
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

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
    })
    expect(mockedRunSearch).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1200)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockedRunSearch).toHaveBeenCalledTimes(1)

    await act(async () => {
      languageMetadata.resolve({
        ok: true,
        options: [englishSearchLanguage],
        countrySuggestion: null,
        recommendedLanguage: null,
        countryCode: null,
        countryName: null,
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      loadMoreButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        query: "jesus",
        offset: 10,
        languageEnglishNames: [],
        languageSlug: null,
        languageSlugIsExplicit: false,
      }),
    )
  })
})
