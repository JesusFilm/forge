/**
 * @vitest-environment jsdom
 */
import {
  Profiler,
  StrictMode,
  act,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { setRequestLocale } from "next-intl/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import englishMessages from "../../../messages/en.json"

import {
  FloatingSearchController,
  resetSearchLanguageOptionsCacheForTest,
} from "@/components/FloatingSearchController"
import {
  FloatingSearchProvider,
  useFloatingSearch,
} from "@/components/FloatingSearchProvider"
import { SearchOverlayInstantShell } from "@/components/SearchOverlayInstantShell"
import { WatchRouteSurfaceRegistration } from "@/components/WatchRouteSurfaceRegistration"
import {
  FLOATING_HEADER_FIELD_WIDTH_CLASS,
  FLOATING_HEADER_LAYOUT_CLASS,
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
} from "@/lib/search-actions"
import { getSearchLanguageOptions } from "@/lib/search-language-actions"
import {
  fetchWatchSearchSuggestions,
  searchWatchDirect,
  type WatchSearchSuggestion,
} from "@/lib/watch-search-client"
import {
  __resetWatchInteractionLoaderForTests,
  __setWatchInteractionLoadersForTests,
} from "@/lib/watch-interaction-loader"
import { MAX_WATCH_SEARCH_QUERY_CODE_POINTS } from "@/lib/watch-search-query"
import type {
  SearchActionResult,
  SearchActionResultSource,
  SearchResponse,
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
import { WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY } from "@/lib/watch-unavailable-recovery-context"

const navigationMocks = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
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
    push: navigationMocks.push,
    replace: navigationMocks.replace,
  }),
}))

vi.mock("@/lib/search-actions", () => ({
  recordWatchSearchResultClick: vi.fn(async () => ({ ok: true })),
  recordWatchSearchResultsViewed: vi.fn(async () => ({ ok: true })),
}))

vi.mock("@/lib/watch-search-client", () => ({
  fetchWatchSearchSuggestions: vi.fn(),
  searchWatchDirect: vi.fn(),
  watchSearchErrorKind: vi.fn((error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof error.kind === "string"
      ? error.kind
      : "unknown",
  ),
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

vi.mock("@/components/watch/GlobalLanguagePickerModal", () => ({
  GlobalLanguagePickerModal: ({
    open,
    currentLanguageSlug,
    onClose,
  }: {
    open: boolean
    currentLanguageSlug: string
    onClose: () => void
  }) => {
    useEffect(() => {
      if (!open) return
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") onClose()
      }
      document.addEventListener("keydown", handleKeyDown)
      return () => document.removeEventListener("keydown", handleKeyDown)
    }, [onClose, open])

    return open ? (
      <div
        role="dialog"
        aria-modal="true"
        data-testid="global-language-picker-modal"
        data-current-language-slug={currentLanguageSlug}
      >
        <button type="button" onClick={onClose}>
          Close global language picker
        </button>
      </div>
    ) : null
  },
}))

let container: HTMLDivElement
let root: Root
const mockedRunSearch = vi.mocked(searchWatchDirect)
const mockedFetchSuggestions = vi.mocked(fetchWatchSearchSuggestions)
const mockedGetSearchLanguageOptions = vi.mocked(getSearchLanguageOptions)

function watchSuggestion(
  title: string,
  description: string | null = null,
  matchSource: "title" | "description" = "title",
): WatchSearchSuggestion {
  return {
    kind: "query",
    title,
    description,
    matchSource,
    id: null,
    slug: null,
    label: null,
    childCount: null,
  }
}

function watchContentMatch(
  title: string,
  label: WatchSearchSuggestion["label"],
  slug: string,
  description: string | null = null,
): WatchSearchSuggestion {
  return {
    kind: "content",
    title,
    description,
    matchSource: "title",
    id: `video-${slug}`,
    slug,
    label,
    childCount: label === "COLLECTION" || label === "SERIES" ? 3 : 0,
  }
}

beforeEach(() => {
  setRequestLocale("en")
  vi.clearAllMocks()
  mockedFetchSuggestions.mockResolvedValue([])
  __resetWatchInteractionLoaderForTests()
  resetSearchLanguageOptionsCacheForTest()
  navigationMocks.pathname = "/"
  setScrollY(0)
  window.history.replaceState(null, "", "/")
  window.sessionStorage.clear()
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
  __resetWatchInteractionLoaderForTests()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

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

const japaneseSearchLanguage = {
  englishName: "Japanese",
  nativeName: "日本語",
  bcp47: "ja",
  publicSlug: "japanese",
  regionNames: ["Asia"],
}

const russianSearchLanguage = {
  englishName: "Russian",
  nativeName: "Русский",
  bcp47: "ru",
  publicSlug: "russian",
  regionNames: ["Europe"],
}

const SPANISH_CONFIRMATION_QUERY = "películas bíblicas para niños cristianos"

function mockEnglishAndSpanishSearchLanguages() {
  mockedGetSearchLanguageOptions.mockResolvedValue({
    ok: true,
    options: [englishSearchLanguage, spanishSearchLanguage],
    countrySuggestion: null,
    recommendedLanguage: englishSearchLanguage,
    countryCode: null,
    countryName: null,
  })
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

type MockSearchResponse = SearchResponse &
  Extract<SearchActionResult, { ok: true }>

function searchResult(
  source: SearchActionResultSource,
  overrides: Partial<Extract<SearchActionResult, { ok: true }>> = {},
): MockSearchResponse {
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
): MockSearchResponse {
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

async function openSearchOverlay(locale?: string): Promise<HTMLInputElement> {
  act(() => {
    if (locale) setRequestLocale(locale)
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
    '[data-testid="floating-search-desktop-button"]',
  ) as HTMLButtonElement
  await act(async () => {
    searchButton.click()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  await flushSearchControllerMount()

  const input = document.querySelector(
    'input[type="search"]',
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

async function submitSearch(input: HTMLInputElement, query: string) {
  act(() => {
    setInputValue(input, query)
  })
  const form = input.form
  expect(form).not.toBeNull()
  if (!form) return
  await act(async () => {
    form.requestSubmit()
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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
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
    errorKind,
    loadMore,
    loading,
    search,
    setOpen,
    showSkeleton,
  } = useFloatingSearch()

  return (
    <div>
      <span data-testid="search-result-count">{displayResults.length}</span>
      <span data-testid="search-error">
        {error == null ? "" : `${errorKind ?? "unknown"}:${error}`}
      </span>
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
  it("does not search an instant-shell draft when the controller mounts", async () => {
    act(() => {
      root.render(
        <SearchControllerTestShell initialOpen initialQuery="jesus" />,
      )
    })

    await flushResolvedSearch()

    expect(mockedRunSearch).not.toHaveBeenCalled()
  })

  it("consumes a cold-shell submit snapshot once", async () => {
    mockedRunSearch.mockResolvedValue(searchResult("watch-search"))
    const intent = { id: 1, query: "jesus" }
    const setQuery = vi.fn()

    act(() => {
      root.render(
        <FloatingSearchController
          open
          closing={false}
          query="jesus edited later"
          setOpen={vi.fn()}
          setQuery={setQuery}
          pendingSubmitIntent={intent}
        />,
      )
    })
    await flushResolvedSearch()

    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "jesus" }),
    )
    expect(setQuery).not.toHaveBeenCalled()

    act(() => {
      root.render(
        <FloatingSearchController
          open
          closing={false}
          query="another draft"
          setOpen={vi.fn()}
          setQuery={setQuery}
          pendingSubmitIntent={intent}
        />,
      )
    })
    await flushResolvedSearch()

    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
  })

  it("passes the actual UI locale while preserving an absent route language", async () => {
    setRequestLocale("es")
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="search-mode-harness-button"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "es",
        languageContext: expect.objectContaining({
          routeLanguageSlug: null,
        }),
      }),
    )
  })

  it("preserves a canonical English localized-home route", async () => {
    navigationMocks.pathname = "/english.html"
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="search-mode-harness-button"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "en",
        languageContext: expect.objectContaining({
          routeLanguageSlug: "english",
        }),
      }),
    )
  })

  it("uses English as the route language for a registered language-less video", async () => {
    navigationMocks.pathname = "/jesus.html"
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

    act(() => {
      root.render(
        <FloatingSearchProvider>
          <WatchRouteSurfaceRegistration surface="english-video" />
          <SearchControllerTestShell>
            <SearchModeHarness />
          </SearchControllerTestShell>
        </FloatingSearchProvider>,
      )
    })

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="search-mode-harness-button"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "en",
        languageContext: expect.objectContaining({
          routeLanguageSlug: "english",
        }),
      }),
    )
  })

  it.each([
    "/not-a-language.html",
    "/lumo.html/episode/not-a-language.html",
    "/not-a-language.html/languages",
    "/not-a-language.html/history",
    "/not-a-language.html/videos",
  ])("does not forward an invalid route language from %s", async (pathname) => {
    navigationMocks.pathname = pathname
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="search-mode-harness-button"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        languageContext: expect.objectContaining({
          routeLanguageSlug: null,
        }),
      }),
    )
  })

  it("uses English for a two-segment contextual candidate", async () => {
    navigationMocks.pathname = "/jesus.html/not-a-language.html"
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

    act(() => {
      root.render(
        <SearchControllerTestShell>
          <SearchModeHarness />
        </SearchControllerTestShell>,
      )
    })

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="search-mode-harness-button"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        languageContext: expect.objectContaining({
          routeLanguageSlug: "english",
        }),
      }),
    )
  })

  it.each([
    "/french.html/videos",
    "/french.html/languages",
    "/french.html/history",
  ])(
    "keeps the route language on localized utility route %s",
    async (pathname) => {
      navigationMocks.pathname = pathname
      mockedGetSearchLanguageOptions.mockResolvedValueOnce({
        ok: true,
        options: [englishSearchLanguage],
        countrySuggestion: null,
        recommendedLanguage: englishSearchLanguage,
        countryCode: null,
        countryName: null,
      })
      mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

      act(() => {
        root.render(
          <SearchControllerTestShell>
            <SearchModeHarness />
          </SearchControllerTestShell>,
        )
      })

      await act(async () => {
        ;(
          document.querySelector(
            '[data-testid="search-mode-harness-button"]',
          ) as HTMLButtonElement
        ).click()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mockedRunSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          languageContext: expect.objectContaining({
            routeLanguageSlug: "french",
          }),
        }),
      )
    },
  )

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
    await flushSearchControllerMount()

    expect(resultCount?.textContent).toBe("1")
    expect(mockedRunSearch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        query: "jesus",
        languageContext: expect.objectContaining({
          routeLanguageSlug: "spanish-castilian",
          targetLanguageSlug: null,
        }),
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
        languageContext: expect.objectContaining({
          routeLanguageSlug: "spanish-castilian",
          targetLanguageSlug: null,
        }),
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
    let resolveFirstSearch: (value: MockSearchResponse) => void = () => {}
    const firstSearch = new Promise<MockSearchResponse>((resolve) => {
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
    const searchFieldShell = searchButton?.parentElement
    const header = document.querySelector('[data-testid="floating-header"]')
    const trailingControls = document.querySelector(
      '[data-testid="floating-header-trailing-controls"]',
    )
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
    expect(header?.className).toContain(FLOATING_HEADER_LAYOUT_CLASS)
    expect(header?.className).toContain(
      "grid-cols-[minmax(80px,1fr)_minmax(0,800px)_minmax(80px,1fr)]",
    )
    expect(header?.className).toContain(
      "md:grid-cols-[minmax(139px,1fr)_minmax(0,800px)_minmax(139px,1fr)]",
    )
    expect(header?.className).toContain("items-center")
    expect(header?.className).toContain("gap-3")
    expect(searchFieldShell?.className).toContain(
      FLOATING_HEADER_FIELD_WIDTH_CLASS,
    )
    expect(searchFieldShell?.className).toContain("max-w-[800px]")
    expect(trailingControls?.className).toContain("ml-auto")
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
    expect(searchLabels?.[0]?.textContent).toBe("Search videos")
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
  it.each([
    ["root home", "/", "english", "EN"],
    ["localized home", "/spanish-castilian.html", "spanish-castilian", "ES"],
    ["legacy videos index", "/videos", "english", "EN"],
    ["authored experience", "/easter.html", "english", "EN"],
    ["languages index", "/languages", "english", "EN"],
    ["localized languages", "/aari.html/languages", "english", "AIW"],
    ["language inventory", "/aari.html/videos", "english", "AIW"],
    ["history", "/history", "english", "EN"],
    ["localized history", "/aari.html/history", "english", "AIW"],
    ["unknown route", "/not/a/valid/watch/route", "english", "EN"],
    [
      "content without alternatives",
      "/jesus.html/english.html",
      "english",
      "EN",
    ],
  ])(
    "renders one global fallback with the active code on %s",
    (_label, pathname, defaultLanguageSlug, expectedCode) => {
      navigationMocks.pathname = pathname
      act(() => {
        root.render(
          <FloatingSearchProvider defaultLanguageSlug={defaultLanguageSlug}>
            <main>Page</main>
          </FloatingSearchProvider>,
        )
      })

      const languageButtons = document.querySelectorAll(
        '[data-testid="floating-header-language-button"]',
      )
      expect(languageButtons).toHaveLength(1)
      expect(
        languageButtons[0]?.querySelector(
          '[data-testid="floating-header-language-code"]',
        )?.textContent,
      ).toBe(expectedCode)
    },
  )

  it.each([
    ["uses the page-specific code", "PT", "PT"],
    ["falls back to the route code", undefined, "RU"],
  ])(
    "%s for a page-specific language switcher",
    (_label, languageCode, expectedCode) => {
      const onLanguageClick = vi.fn()
      navigationMocks.pathname = "/jesus.html/russian.html"
      act(() => {
        root.render(
          <FloatingSearchProvider defaultLanguageSlug="russian">
            <main>Russian video</main>
          </FloatingSearchProvider>,
        )
      })

      act(() => {
        dispatchLanguageSwitcher({
          visible: true,
          onClick: onLanguageClick,
          languageCode,
        })
      })

      const languageButton = document.querySelector(
        '[data-testid="floating-header-language-button"]',
      ) as HTMLButtonElement
      expect(
        languageButton.querySelector(
          '[data-testid="floating-header-language-code"]',
        )?.textContent,
      ).toBe(expectedCode)

      act(() => languageButton.click())

      expect(onLanguageClick).toHaveBeenCalledTimes(1)
      expect(
        document.querySelector('[data-testid="global-language-picker-modal"]'),
      ).toBeNull()
    },
  )

  it("marks the global trigger busy during lazy loading and blocks duplicate activation", async () => {
    const moduleLoad = deferred<unknown>()
    const globalLanguageLoader = vi.fn(() => moduleLoad.promise)
    __setWatchInteractionLoadersForTests({
      "global-language": globalLanguageLoader,
    })

    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    ) as HTMLButtonElement
    expect(languageButton.getAttribute("aria-label")).toBe(
      "Change audio language",
    )
    expect(languageButton.className).toContain("focus-visible:ring-2")

    act(() => {
      languageButton.click()
      languageButton.click()
    })

    expect(languageButton.getAttribute("aria-busy")).toBe("true")
    expect(languageButton.disabled).toBe(true)
    expect(globalLanguageLoader).toHaveBeenCalledTimes(1)
    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()

    await act(async () => {
      moduleLoad.resolve({})
      await moduleLoad.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(languageButton.getAttribute("aria-busy")).toBe("false")
    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).not.toBeNull()
  })

  it("recovers the global trigger after a module-load failure and retries", async () => {
    const globalLanguageLoader = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({})
    __setWatchInteractionLoadersForTests({
      "global-language": globalLanguageLoader,
    })

    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })
    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    ) as HTMLButtonElement

    await act(async () => {
      languageButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(languageButton.disabled).toBe(false)
    expect(languageButton.getAttribute("aria-busy")).toBe("false")
    expect(
      document.querySelector(
        '[data-testid="global-language-picker-load-error"]',
      )?.textContent,
    ).toContain("Please check your connection")
    expect(languageButton.getAttribute("aria-label")).toContain(
      "Please check your connection",
    )
    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()

    await act(async () => {
      languageButton.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(globalLanguageLoader).toHaveBeenCalledTimes(2)
    expect(
      document.querySelector(
        '[data-testid="global-language-picker-load-error"]',
      ),
    ).toBeNull()
    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).not.toBeNull()
  })

  it("does not open a deferred global picker after a page owner takes over", async () => {
    const moduleLoad = deferred<unknown>()
    const pageSpecificClick = vi.fn()
    __setWatchInteractionLoadersForTests({
      "global-language": vi.fn(() => moduleLoad.promise),
    })
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })
    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    ) as HTMLButtonElement
    act(() => languageButton.click())
    act(() => {
      dispatchLanguageSwitcher({
        visible: true,
        onClick: pageSpecificClick,
        ownerToken: Symbol("page picker"),
      })
    })

    await act(async () => {
      moduleLoad.resolve({})
      await moduleLoad.promise
      await Promise.resolve()
    })

    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()
    act(() => languageButton.click())
    expect(pageSpecificClick).toHaveBeenCalledTimes(1)
  })

  it("does not open a deferred global picker after search supersedes it", async () => {
    const moduleLoad = deferred<unknown>()
    __setWatchInteractionLoadersForTests({
      "global-language": vi.fn(() => moduleLoad.promise),
    })
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })
    act(() => {
      ;(
        document.querySelector(
          '[data-testid="floating-header-language-button"]',
        ) as HTMLButtonElement
      ).click()
      ;(
        document.querySelector(
          '[data-testid="floating-search-desktop-button"]',
        ) as HTMLButtonElement
      ).click()
    })

    await act(async () => {
      moduleLoad.resolve({})
      await moduleLoad.promise
      await Promise.resolve()
    })

    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()
    expect(
      document.querySelector('[data-testid="floating-header-search-close"]'),
    ).not.toBeNull()
  })

  it("replaces search with the global picker without overlapping modal surfaces", async () => {
    vi.useFakeTimers()
    __setWatchInteractionLoadersForTests({
      "global-language": vi.fn(async () => ({})),
    })
    await openSearchOverlay()

    expect(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ).toHaveLength(1)

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="floating-header-language-button"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()
    expect(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(220)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      document.querySelector('input[aria-label="Search videos by keyword"]'),
    ).toBeNull()
    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).not.toBeNull()
    expect(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ).toHaveLength(1)

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })

    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()
    expect(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ).toHaveLength(0)
  })

  it("defers a page-specific picker until the search modal closes", async () => {
    vi.useFakeTimers()
    const pageDialog = document.createElement("div")
    pageDialog.setAttribute("role", "dialog")
    pageDialog.setAttribute("aria-modal", "true")
    const onLanguageClick = vi.fn(() => document.body.appendChild(pageDialog))
    await openSearchOverlay()
    act(() => {
      dispatchLanguageSwitcher({
        visible: true,
        onClick: onLanguageClick,
        ownerToken: Symbol("page picker"),
      })
    })

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="floating-header-language-button"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
    })

    expect(onLanguageClick).not.toHaveBeenCalled()
    expect(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(220)
      await Promise.resolve()
    })

    expect(onLanguageClick).toHaveBeenCalledTimes(1)
    expect(
      document.querySelector('input[aria-label="Search videos by keyword"]'),
    ).toBeNull()
    expect(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ).toHaveLength(1)
  })

  it("does not open a deferred global picker after the route changes", async () => {
    const moduleLoad = deferred<unknown>()
    navigationMocks.pathname = "/jesus.html/english.html"
    __setWatchInteractionLoadersForTests({
      "global-language": vi.fn(() => moduleLoad.promise),
    })
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>English page</main>
        </FloatingSearchProvider>,
      )
    })
    act(() => {
      ;(
        document.querySelector(
          '[data-testid="floating-header-language-button"]',
        ) as HTMLButtonElement
      ).click()
    })
    navigationMocks.pathname = "/jesus.html/spanish-castilian.html"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Spanish page</main>
        </FloatingSearchProvider>,
      )
    })

    await act(async () => {
      moduleLoad.resolve({})
      await moduleLoad.promise
      await Promise.resolve()
    })

    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()
    navigationMocks.pathname = "/jesus.html/english.html"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>English page again</main>
        </FloatingSearchProvider>,
      )
    })
    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()
  })

  it("does not restore a closed global picker when returning to its previous route", async () => {
    navigationMocks.pathname = "/jesus.html/english.html"
    __setWatchInteractionLoadersForTests({
      "global-language": vi.fn(async () => ({})),
    })
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>English page</main>
        </FloatingSearchProvider>,
      )
    })

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="floating-header-language-button"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).not.toBeNull()

    navigationMocks.pathname = "/jesus.html/spanish-castilian.html"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Spanish page</main>
        </FloatingSearchProvider>,
      )
    })
    navigationMocks.pathname = "/jesus.html/english.html"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>English page again</main>
        </FloatingSearchProvider>,
      )
    })

    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()
  })

  it("does not complete a deferred global picker load after unmount", async () => {
    const moduleLoad = deferred<unknown>()
    const isolatedContainer = document.createElement("div")
    document.body.appendChild(isolatedContainer)
    const isolatedRoot = createRoot(isolatedContainer)
    __setWatchInteractionLoadersForTests({
      "global-language": vi.fn(() => moduleLoad.promise),
    })
    act(() => {
      isolatedRoot.render(
        <FloatingSearchProvider>
          <main>Temporary page</main>
        </FloatingSearchProvider>,
      )
    })
    act(() => {
      ;(
        isolatedContainer.querySelector(
          '[data-testid="floating-header-language-button"]',
        ) as HTMLButtonElement
      ).click()
      isolatedRoot.unmount()
    })

    await act(async () => {
      moduleLoad.resolve({})
      await moduleLoad.promise
      await Promise.resolve()
    })

    expect(isolatedContainer.childElementCount).toBe(0)
    isolatedContainer.remove()
  })

  it("derives the global picker's current public language from the route", async () => {
    navigationMocks.pathname = "/jesus.html/spanish-castilian.html"
    __setWatchInteractionLoadersForTests({
      "global-language": vi.fn(async () => ({})),
    })
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    ) as HTMLButtonElement
    await act(async () => {
      languageButton.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      document
        .querySelector('[data-testid="global-language-picker-modal"]')
        ?.getAttribute("data-current-language-slug"),
    ).toBe("spanish-castilian")
  })

  it.each([
    ["root home", "/", "english", undefined],
    ["localized home", "/russian.html", "russian", "russian"],
    ["authored experience", "/easter.html", "english", undefined],
  ])(
    "opens the global picker from %s with a valid current language",
    async (_label, pathname, expectedLanguageSlug, defaultLanguageSlug) => {
      navigationMocks.pathname = pathname
      __setWatchInteractionLoadersForTests({
        "global-language": vi.fn(async () => ({})),
      })
      act(() => {
        root.render(
          <FloatingSearchProvider defaultLanguageSlug={defaultLanguageSlug}>
            <main>Page</main>
          </FloatingSearchProvider>,
        )
      })

      const languageButton = document.querySelector(
        '[data-testid="floating-header-language-button"]',
      ) as HTMLButtonElement
      await act(async () => {
        languageButton.click()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(
        document
          .querySelector('[data-testid="global-language-picker-modal"]')
          ?.getAttribute("data-current-language-slug"),
      ).toBe(expectedLanguageSlug)
    },
  )

  it("keeps the newest page-specific owner when an older owner cleans up", () => {
    const firstOwner = Symbol("first hero")
    const secondOwner = Symbol("second hero")
    const firstClick = vi.fn()
    const secondClick = vi.fn()
    act(() => {
      root.render(
        <StrictMode>
          <FloatingSearchProvider>
            <main>Page</main>
          </FloatingSearchProvider>
        </StrictMode>,
      )
    })

    act(() => {
      dispatchLanguageSwitcher({
        visible: true,
        onClick: firstClick,
        ownerToken: firstOwner,
      })
      dispatchLanguageSwitcher({
        visible: true,
        onClick: secondClick,
        ownerToken: secondOwner,
      })
      dispatchLanguageSwitcher({
        visible: false,
        onClick: null,
        ownerToken: firstOwner,
      })
    })

    act(() => {
      ;(
        document.querySelector(
          '[data-testid="floating-header-language-button"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(firstClick).not.toHaveBeenCalled()
    expect(secondClick).toHaveBeenCalledTimes(1)
    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()
  })

  it("restores the global fallback after matching cleanup and route changes", async () => {
    const ownerToken = Symbol("route owner")
    const pageSpecificClick = vi.fn()
    const globalLanguageLoader = vi.fn(async () => ({}))
    __setWatchInteractionLoadersForTests({
      "global-language": globalLanguageLoader,
    })
    navigationMocks.pathname = "/jesus.html/english.html"
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
        onClick: pageSpecificClick,
        ownerToken,
      })
    })

    navigationMocks.pathname = "/languages"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Languages</main>
        </FloatingSearchProvider>,
      )
    })

    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
    ) as HTMLButtonElement
    await act(async () => {
      languageButton.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(pageSpecificClick).not.toHaveBeenCalled()
    expect(globalLanguageLoader).toHaveBeenCalledTimes(1)

    act(() => {
      dispatchLanguageSwitcher({
        visible: false,
        onClick: null,
        ownerToken,
      })
    })
    expect(
      document.querySelectorAll(
        '[data-testid="floating-header-language-button"]',
      ),
    ).toHaveLength(1)
  })

  it("warms the global picker only after the page load idle boundary", async () => {
    vi.useFakeTimers()
    const globalLanguageLoader = vi.fn(async () => ({}))
    const unrelatedInteractionLoaders = {
      language: vi.fn(async () => ({})),
      search: vi.fn(async () => ({})),
      share: vi.fn(async () => ({})),
      download: vi.fn(async () => ({})),
    }
    __setWatchInteractionLoadersForTests({
      "global-language": globalLanguageLoader,
      ...unrelatedInteractionLoaders,
    })

    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })
    expect(globalLanguageLoader).not.toHaveBeenCalled()

    await act(async () => {
      window.dispatchEvent(new Event("load"))
      vi.advanceTimersByTime(249)
      await Promise.resolve()
    })
    expect(globalLanguageLoader).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(globalLanguageLoader).toHaveBeenCalledTimes(1)
    expect(
      document.querySelector('[data-testid="global-language-picker-modal"]'),
    ).toBeNull()
    for (const loader of Object.values(unrelatedInteractionLoaders)) {
      expect(loader).not.toHaveBeenCalled()
    }
  })

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

  it("uses compact English-video chrome on the language-less canonical route and explicit compatibility route", () => {
    for (const pathname of [
      "/jesus.html",
      "/jesus.html/english.html",
    ] as const) {
      navigationMocks.pathname = pathname
      act(() => {
        root.render(
          <FloatingSearchProvider>
            <WatchRouteSurfaceRegistration surface="english-video" />
            <main>English video</main>
          </FloatingSearchProvider>,
        )
      })

      const logo = document.querySelector(
        '[data-testid="floating-header-logo"]',
      )
      expect(logo?.getAttribute("href")).toBe("/")
      expect(logo?.querySelector("img")?.getAttribute("src")).toBe(
        "/watch/images/jesusfilm-sign.svg",
      )
    }
  })

  it("server-renders manifest-only Experience chrome from the route seed", () => {
    navigationMocks.pathname = "/new-collection.html"

    const html = renderToString(
      <FloatingSearchProvider initialRouteSurface="experience">
        <main>Manifest-only Experience</main>
      </FloatingSearchProvider>,
    )

    expect(html).toContain('href="https://www.jesusfilm.org/"')
    expect(html).toContain("/watch/images/jesus-film-logo-full.svg")
    expect(html).not.toContain("/watch/images/jesusfilm-sign.svg")
  })

  it("does not commit a second render when registration confirms the server seed", () => {
    navigationMocks.pathname = "/new-collection.html"
    const phases: string[] = []

    act(() => {
      root.render(
        <Profiler
          id="seeded-route-surface"
          onRender={(_id, phase) => phases.push(phase)}
        >
          <FloatingSearchProvider initialRouteSurface="experience">
            <WatchRouteSurfaceRegistration surface="experience" />
            <main>Manifest-only Experience</main>
          </FloatingSearchProvider>
        </Profiler>,
      )
    })

    expect(phases).toEqual(["mount"])
  })

  it("keeps language homes and manifest-only Experiences home-like after page registration", () => {
    for (const [pathname, surface] of [
      ["/russian.html", "language-home"],
      ["/new-collection.html", "experience"],
    ] as const) {
      navigationMocks.pathname = pathname
      act(() => {
        root.render(
          <FloatingSearchProvider>
            <WatchRouteSurfaceRegistration surface={surface} />
            <main>Home-like page</main>
          </FloatingSearchProvider>,
        )
      })

      expect(
        document
          .querySelector('[data-testid="floating-header-logo"] img')
          ?.getAttribute("src"),
      ).toBe("/watch/images/jesus-film-logo-full.svg")
    }
  })

  it("ignores a stale page registration after client navigation", () => {
    navigationMocks.pathname = "/new-collection.html"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <WatchRouteSurfaceRegistration surface="experience" />
          <main>Experience</main>
        </FloatingSearchProvider>,
      )
    })
    expect(
      document
        .querySelector('[data-testid="floating-header-logo"] img')
        ?.getAttribute("src"),
    ).toBe("/watch/images/jesus-film-logo-full.svg")

    navigationMocks.pathname = "/jesus.html"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <WatchRouteSurfaceRegistration surface="english-video" />
          <main>Exact video collision winner</main>
        </FloatingSearchProvider>,
      )
    })

    expect(
      document
        .querySelector('[data-testid="floating-header-logo"] img')
        ?.getAttribute("src"),
    ).toBe("/watch/images/jesusfilm-sign.svg")
  })

  it("keeps the current custom language when the compact logo returns to Watch home", () => {
    navigationMocks.pathname = "/jesus.html/women-disciples/hindi.html"
    act(() => {
      root.render(
        <FloatingSearchProvider defaultLanguageSlug="hindi">
          <main>Hindi episode page</main>
        </FloatingSearchProvider>,
      )
    })

    const logo = document.querySelector('[data-testid="floating-header-logo"]')
    expect(logo?.getAttribute("href")).toBe("/hindi.html")
  })

  it("keeps the default Watch home fallback for a malformed inner-route language", () => {
    navigationMocks.pathname = "/jesus.html/not!a!language.html"
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Malformed video route</main>
        </FloatingSearchProvider>,
      )
    })

    const logo = document.querySelector('[data-testid="floating-header-logo"]')
    expect(logo?.getAttribute("href")).toBe("/")
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

describe("FloatingSearchProvider — language videos link", () => {
  const ISOLATE_START = "\u2068"
  const ISOLATE_END = "\u2069"

  function languageVideosLink(): HTMLAnchorElement | null {
    return document.querySelector(
      '[data-testid="floating-header-language-videos-link"]',
    )
  }

  it.each([
    ["root home", "/", "english", "/english.html/videos", "English"],
    [
      "localized home",
      "/spanish-castilian.html",
      "english",
      "/spanish-castilian.html/videos",
      "Spanish Castilian",
    ],
    // The route language wins over the provider default — a Russian video
    // page must link to the Russian inventory, not the visitor's home one.
    [
      "video route",
      "/jesus.html/russian.html",
      "english",
      "/russian.html/videos",
      "Russian",
    ],
    [
      "localized languages",
      "/aari.html/languages",
      "english",
      "/aari.html/videos",
      "Aari",
    ],
    [
      "localized history",
      "/aari.html/history",
      "english",
      "/aari.html/videos",
      "Aari",
    ],
  ])(
    "links to the header language inventory on %s",
    (_label, pathname, defaultLanguageSlug, expectedHref, expectedLanguage) => {
      navigationMocks.pathname = pathname
      act(() => {
        root.render(
          <FloatingSearchProvider defaultLanguageSlug={defaultLanguageSlug}>
            <main>Page</main>
          </FloatingSearchProvider>,
        )
      })

      const link = languageVideosLink()
      expect(link).not.toBeNull()
      expect(link?.getAttribute("href")).toBe(expectedHref)
      // The control now carries a visible "Library" label, so that text — not
      // an `aria-label` — is its accessible name. An `aria-label` of "See all
      // videos in X" would not contain the visible label, breaking WCAG 2.5.3
      // Label in Name.
      expect(link?.textContent?.trim()).toBe("Library")
      expect(link?.hasAttribute("aria-label")).toBe(false)
      // The language-specific phrasing survives as the hover tooltip. Bidi
      // isolation keeps an RTL language name from reordering the surrounding
      // words of the translated sentence.
      expect(link?.getAttribute("title")).toBe(
        `See all videos in ${ISOLATE_START}${expectedLanguage}${ISOLATE_END}`,
      )
      // Glyph still present alongside the label, and it is the shared video-
      // library glyph — the watch-home "See all video collections" CTA renders
      // the same one via `WatchLibraryIcon`.
      expect(link?.querySelector("svg")?.getAttribute("class")).toContain(
        "lucide-list-video",
      )
    },
  )

  it("renders no link on the language inventory page itself", () => {
    navigationMocks.pathname = "/aari.html/videos"
    act(() => {
      root.render(
        <FloatingSearchProvider defaultLanguageSlug="english">
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    expect(languageVideosLink()).toBeNull()
    // The language globe still resolves the route language, so the absent
    // link is the inventory-route rule and not a slug-resolution failure.
    expect(
      document
        .querySelector('[data-testid="floating-header-language-button"]')
        ?.querySelector('[data-testid="floating-header-language-code"]')
        ?.textContent,
    ).toBe("AIW")
  })

  it("renders no link when the header language segment is not a public watch language", () => {
    // `/{anything}.html/history` parses as a localized-utility route with an
    // unvalidated language segment, so an authored-collection slug reaches
    // the header. The inventory route 404s for it — link must be absent.
    navigationMocks.pathname = "/easter.html/history"
    act(() => {
      root.render(
        <FloatingSearchProvider defaultLanguageSlug="english">
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    expect(languageVideosLink()).toBeNull()
  })

  it("renders the link immediately before the language button", () => {
    navigationMocks.pathname = "/spanish-castilian.html"
    act(() => {
      root.render(
        <FloatingSearchProvider defaultLanguageSlug="english">
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const trailingControls = document.querySelector(
      '[data-testid="floating-header-trailing-controls"]',
    )
    const slots = Array.from(trailingControls?.children ?? []).map((child) =>
      child.getAttribute("data-testid"),
    )
    expect(slots.slice(0, 2)).toEqual([
      "floating-header-language-videos-link",
      "floating-header-language-button",
    ])
  })

  it("reveals the link from the md breakpoint up", () => {
    // jsdom cannot evaluate media queries, so the class tokens are the pin.
    // Measured at 375px against `next start`: a third 44px trailing control
    // overflows the mobile `minmax(80px,1fr)` column and clips the language
    // globe, so the link stays hidden until the md header layout.
    navigationMocks.pathname = "/spanish-castilian.html"
    act(() => {
      root.render(
        <FloatingSearchProvider defaultLanguageSlug="english">
          <main>Page</main>
        </FloatingSearchProvider>,
      )
    })

    const className = languageVideosLink()?.className ?? ""
    expect(className).toContain("hidden")
    expect(className).toContain("md:inline-flex")
    expect(className).not.toMatch(/(^|\s)inline-flex(\s|$)/)
  })

  it("drops the link from the search-open header at every width", async () => {
    // The overlay renders its own full-width row above the category tiles
    // while the modal is open, so the header control stands down entirely
    // rather than competing with it.
    navigationMocks.pathname = "/spanish-castilian.html"
    await openSearchOverlay()

    const trailingControls = document.querySelector(
      '[data-testid="floating-header-trailing-controls"]',
    )
    const slots = Array.from(trailingControls?.children ?? []).map((child) =>
      child.getAttribute("data-testid"),
    )
    expect(slots).toEqual([
      "floating-header-language-button",
      "floating-header-search-close",
    ])
    expect(languageVideosLink()).toBeNull()
  })
})

describe("FloatingSearchProvider — search overlay language videos row", () => {
  function overlayRow(): HTMLAnchorElement | null {
    return document.querySelector(
      '[data-testid="search-overlay-language-videos-link"]',
    )
  }

  it("renders the row above the category tiles for the header language", async () => {
    navigationMocks.pathname = "/spanish-castilian.html"
    await openSearchOverlay()

    const row = overlayRow()
    expect(row).not.toBeNull()
    expect(row?.getAttribute("href")).toBe("/spanish-castilian.html/videos")
    expect(row?.textContent).toContain(
      englishMessages.SearchOverlay.allVideosOnSinglePage,
    )

    const tile = document.querySelector(
      '[data-testid="search-overlay-category-bible-stories"]',
    )
    expect(tile).not.toBeNull()
    expect(row).not.toBeNull()
    const tilesFollowRow =
      (row as HTMLAnchorElement).compareDocumentPosition(tile as Node) &
      Node.DOCUMENT_POSITION_FOLLOWING
    expect(tilesFollowRow).toBeTruthy()
  })

  it("shows the row at every width, with no header control competing", async () => {
    // jsdom cannot evaluate media queries, so the absent breakpoint token is
    // the pin: this row carries no `md:` visibility variant, and the header
    // control is not rendered at all while the modal is open.
    navigationMocks.pathname = "/spanish-castilian.html"
    await openSearchOverlay()

    const rowClass = overlayRow()?.className ?? ""
    expect(rowClass).not.toContain("md:hidden")
    expect(rowClass).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(
      document.querySelector(
        '[data-testid="floating-header-language-videos-link"]',
      ),
    ).toBeNull()
  })

  it("drops the row once results replace the category tiles", async () => {
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))
    navigationMocks.pathname = "/spanish-castilian.html"
    const input = await openSearchOverlay()
    expect(overlayRow()).not.toBeNull()

    await submitSearch(input, "jesus")
    await flushResolvedSearch()

    expect(
      document.querySelector(
        '[data-testid="search-overlay-category-bible-stories"]',
      ),
    ).toBeNull()
    expect(overlayRow()).toBeNull()
  })

  it("renders no row when the header language has no public inventory route", async () => {
    // `/{anything}.html/history` parses as a localized-utility route with an
    // unvalidated language segment; the inventory route 404s for it.
    navigationMocks.pathname = "/easter.html/history"
    await openSearchOverlay()

    expect(
      document.querySelector(
        '[data-testid="search-overlay-category-bible-stories"]',
      ),
    ).not.toBeNull()
    expect(overlayRow()).toBeNull()
  })
})

describe("FloatingSearchProvider — search overlay chrome", () => {
  it.each([
    { locale: "ar", label: "قصص الكتاب المقدس" },
    { locale: "en", label: "Bible Stories" },
    { locale: "ru", label: "Библейские истории" },
    { locale: "zh-Hans", label: "圣经故事" },
  ])(
    "submits the localized Bible Stories topic in $locale",
    async ({ locale, label }) => {
      mockedRunSearch.mockResolvedValueOnce(
        searchResult("watch-search", { query: label }),
      )

      const input = await openSearchOverlay(locale)

      const category = document.querySelector(
        '[data-testid="search-overlay-category-bible-stories"]',
      ) as HTMLButtonElement
      expect(category.getAttribute("aria-label")).toBe(label)

      await act(async () => {
        category.click()
        await Promise.resolve()
        await Promise.resolve()
      })
      await flushResolvedSearch()

      expect(input.value).toBe(label)
      expect(mockedRunSearch).toHaveBeenCalledTimes(1)
      expect(mockedRunSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: label }),
      )
    },
  )

  it("keeps keyword edits local until the search form is submitted", async () => {
    vi.useFakeTimers()
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

    const input = await openSearchOverlay()
    const form = input.closest("form")
    const submitButton = form?.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )
    const leadingIcon = form?.querySelector(
      '[data-testid="search-overlay-input-icon"], [data-testid="search-overlay-instant-input-icon"]',
    )

    expect(form).not.toBeNull()
    expect(input.type).toBe("search")
    expect(input.getAttribute("enterkeyhint")).toBe("search")
    expect(leadingIcon).not.toBeNull()
    expect(leadingIcon?.closest("button")).toBeNull()
    expect(submitButton).toBeNull()

    act(() => {
      setInputValue(input, "jesus")
      vi.advanceTimersByTime(1_500)
    })

    expect(mockedRunSearch).not.toHaveBeenCalled()

    expect(form?.getAttribute("aria-label")).toBe("Search videos")
    expect(leadingIcon?.parentElement?.className).toContain("max-[359px]:w-0")

    await act(async () => {
      form?.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "jesus" }),
    )
  })

  it("coalesces repeated submits for the same active query", async () => {
    const pendingSearch = deferred<MockSearchResponse>()
    mockedRunSearch.mockReturnValueOnce(pendingSearch.promise)

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "jesus"))

    await act(async () => {
      input.form?.requestSubmit()
      input.form?.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledTimes(1)

    await act(async () => {
      pendingSearch.resolve(searchResult("watch-search"))
      await pendingSearch.promise
      await Promise.resolve()
    })
  })

  it("allows the same query to resubmit after clear supersedes a pending search", async () => {
    const pendingSearch = deferred<MockSearchResponse>()
    mockedRunSearch
      .mockReturnValueOnce(pendingSearch.promise)
      .mockResolvedValueOnce(searchResult("watch-search"))

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "jesus"))
    await act(async () => {
      input.form?.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;(
        document.querySelector(
          'button[aria-label="Clear search"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      setInputValue(input, "jesus")
      input.form?.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledTimes(2)

    await act(async () => {
      pendingSearch.resolve(searchResult("watch-search"))
      await pendingSearch.promise
      await Promise.resolve()
    })
  })

  it("debounces title suggestions after two meaningful characters in the selected language", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Jesus", "The story of Jesus and His ministry."),
      watchSuggestion(
        "The Life of Christ",
        "A quiet opening follows the disciples before the story turns toward Jesus and His calling.",
        "description",
      ),
    ])
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

    const input = await openSearchOverlay()

    act(() => {
      setInputValue(input, "j")
      vi.advanceTimersByTime(180)
    })
    expect(mockedFetchSuggestions).not.toHaveBeenCalled()

    act(() => {
      setInputValue(input, "je")
      vi.advanceTimersByTime(179)
    })
    expect(mockedFetchSuggestions).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
    expect(mockedFetchSuggestions).toHaveBeenCalledWith({
      query: "je",
      languageSlug: "english",
      signal: expect.any(AbortSignal),
    })
    expect(input.getAttribute("role")).toBe("combobox")
    expect(input.getAttribute("aria-autocomplete")).toBe("list")
    expect(input.getAttribute("aria-expanded")).toBe("true")
    expect(input.getAttribute("aria-controls")).toBeTruthy()
    expect(input.getAttribute("aria-busy")).toBe("false")
    const suggestionList = document.querySelector(
      '[role="listbox"][aria-label="Search Suggestions"]',
    )
    const languageTrigger = document.querySelector(
      '[data-testid="language-combobox-trigger"]',
    )
    const suggestionPanel = document.querySelector(
      '[data-testid="search-suggestions-panel"]',
    )
    const languageContext = document.querySelector(
      '[data-testid="search-suggestions-language-context"]',
    )
    expect(suggestionList).not.toBeNull()
    expect(suggestionPanel?.className).toContain("bg-stone-950/92")
    expect(suggestionList?.className).toContain("[scrollbar-width:none]")
    expect(suggestionList?.className).toContain("[&::-webkit-scrollbar]:hidden")
    expect(languageContext?.textContent).toContain("Search in")
    expect(languageContext?.textContent).toContain('for "je"')
    expect(languageContext?.querySelector("strong")?.textContent).toBe("je")
    expect(languageContext?.querySelector("strong")?.className).toContain(
      "font-semibold",
    )
    expect(languageTrigger?.textContent).toBe("English")
    expect(
      languageTrigger?.querySelector(
        '[data-testid="language-combobox-option-code"]',
      ),
    ).toBeNull()
    expect(
      languageTrigger?.querySelector('[data-testid="search-language-icon"]'),
    ).not.toBeNull()
    expect(
      languageTrigger?.querySelector('[data-testid="search-language-chevron"]'),
    ).not.toBeNull()
    expect(
      languageTrigger
        ?.querySelector('[data-testid="search-language-chevron"]')
        ?.getAttribute("class"),
    ).not.toContain("rotate-180")
    expect(languageTrigger?.className).toContain("!border-white/20")
    expect(languageTrigger?.className).toContain("!bg-transparent")
    expect(languageTrigger?.className).toContain("!rounded-lg")
    expect(languageTrigger?.className).not.toContain("!rounded-full")
    const contextSubmit = document.querySelector(
      '[data-testid="search-context-submit"]',
    ) as HTMLButtonElement
    expect(contextSubmit?.getAttribute("aria-label")).toBe(
      'Search in English for "je"',
    )
    expect(contextSubmit?.className).toContain("absolute")
    expect(contextSubmit?.className).toContain("inset-0")
    expect(contextSubmit?.className).toContain("hover:bg-white/[0.06]")
    const suggestionOptions = Array.from(
      document.querySelectorAll('[role="option"]'),
    )
    expect(
      suggestionOptions.map(
        (option) => option.querySelector("bdi")?.textContent,
      ),
    ).toEqual(["Jesus", "The Life of Christ"])
    expect(suggestionOptions[1]?.textContent).toContain(
      "toward Jesus and His calling.",
    )
    expect(suggestionOptions[1]?.querySelector("mark")?.textContent).toBe("Je")

    await act(async () => {
      contextSubmit.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "je" }),
    )
    const submittedLanguageContext = document.querySelector(
      '[data-testid="search-language-context"]',
    )
    expect(submittedLanguageContext?.textContent).toBe("Searching in English")
    expect(
      submittedLanguageContext?.querySelector(
        '[data-testid="search-context-submit"]',
      ),
    ).toBeNull()

    await act(async () => {
      ;(
        submittedLanguageContext?.querySelector(
          '[data-testid="language-combobox-trigger"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      ;(
        document.querySelector(
          '[data-language-slug="spanish-castilian"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
    })

    const changedLanguageContext = document.querySelector(
      '[data-testid="search-language-context"]',
    )
    expect(changedLanguageContext?.textContent).toContain('for "je"')
    expect(
      changedLanguageContext?.querySelector(
        '[data-testid="search-context-submit"]',
      ),
    ).not.toBeNull()
    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
  })

  it("replaces suggestions with a full-panel language search", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Jesus miracles"),
      watchContentMatch("JESUS", "FEATURE_FILM", "jesus"),
    ])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "jes"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    const panel = document.querySelector(
      '[data-testid="search-suggestions-panel"]',
    ) as HTMLElement
    const trigger = document.querySelector(
      '[data-testid="language-combobox-trigger"]',
    ) as HTMLButtonElement
    expect(panel).not.toBeNull()

    await act(async () => {
      trigger.click()
      await Promise.resolve()
    })

    expect(mockedRunSearch).not.toHaveBeenCalled()
    expect(
      trigger
        .querySelector('[data-testid="search-language-chevron"]')
        ?.getAttribute("class"),
    ).toContain("rotate-180")

    const languagePopover = document.querySelector(
      '[data-testid="language-combobox-popover"]',
    ) as HTMLElement
    expect(languagePopover).not.toBeNull()
    expect(languagePopover.style.left).toBe(panel.style.left)
    expect(languagePopover.style.top).toBe(panel.style.top)
    expect(languagePopover.style.width).toBe(panel.style.width)
    expect(languagePopover.style.height).toBe(panel.style.height)
    expect(
      document.querySelector(
        '[role="listbox"][aria-label="Search Suggestions"]',
      ),
    ).toBeNull()
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="language-combobox-search"]'),
    )

    await act(async () => {
      ;(
        languagePopover.querySelector(
          'button[aria-label="Close search"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
    })
    expect(
      document.querySelector(
        '[role="listbox"][aria-label="Search Suggestions"]',
      ),
    ).not.toBeNull()
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="language-combobox-trigger"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      ;(
        document.querySelector(
          '[data-testid="language-combobox-option"][data-language-slug="spanish-castilian"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
    })

    expect(
      document.querySelector('[data-testid="language-combobox-popover"]'),
    ).toBeNull()
    expect(mockedRunSearch).not.toHaveBeenCalled()
  })

  it("opens the language search on the first click before suggestions exist", async () => {
    mockEnglishAndSpanishSearchLanguages()

    await openSearchOverlay()
    const trigger = document.querySelector(
      '[data-testid="language-combobox-trigger"]',
    ) as HTMLButtonElement

    await act(async () => {
      trigger.click()
      await Promise.resolve()
    })

    expect(
      document.querySelector('[data-testid="language-combobox-popover"]'),
    ).not.toBeNull()
    expect(trigger.isConnected).toBe(true)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
  })

  it("restores cached suggestions after blur without another backend request", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Jesus miracles"),
      watchContentMatch("JESUS", "FEATURE_FILM", "jesus"),
    ])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "jes"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()

    act(() => {
      input.blur()
    })
    expect(document.querySelector('[role="listbox"]')).toBeNull()

    act(() => {
      input.focus()
      vi.advanceTimersByTime(500)
    })
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    expect(document.body.textContent).toContain("Jesus miracles")
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
  })

  it("groups query suggestions before direct titles, collections, and scenes", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Jesus miracles"),
      watchContentMatch("Jesus Heals the Paralytic", "SEGMENT", "jesus-heals"),
      watchContentMatch(
        "The Jesus Collection",
        "COLLECTION",
        "jesus-collection",
      ),
      watchContentMatch("JESUS", "FEATURE_FILM", "jesus"),
    ])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "jes"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    const list = document.querySelector('[role="listbox"]')
    const sectionLabels = Array.from(
      list?.querySelectorAll(
        '[data-testid^="search-suggestion-group-"] > div[id$="-heading"]',
      ) ?? [],
    ).map((heading) => heading.textContent)
    expect(sectionLabels).toEqual(["Search Suggestions", "Direct match"])
    const directMatches = list?.querySelector(
      '[data-testid="search-suggestion-group-direct-matches"]',
    )
    const directMatchGroups = Array.from(
      directMatches?.querySelectorAll(':scope > [role="group"]') ?? [],
    )
    expect(
      directMatchGroups.map((section) =>
        section
          .getAttribute("aria-labelledby")
          ?.split(" ")
          .map((id) => document.getElementById(id)?.textContent)
          .join(" "),
      ),
    ).toEqual([
      "Direct match Video",
      "Direct match Collection",
      "Direct match Segment",
    ])
    expect(
      Array.from(list?.querySelectorAll('[role="option"] bdi') ?? []).map(
        (row) => row.textContent,
      ),
    ).toEqual([
      "Jesus miracles",
      "JESUS",
      "The Jesus Collection",
      "Jesus Heals the Paralytic",
    ])

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
    })
    expect(
      list?.querySelector('[role="option"][aria-selected="true"] bdi')
        ?.textContent,
    ).toBe("JESUS")
  })

  it("opens a selected direct content match instead of submitting a search", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Jesus miracles"),
      watchContentMatch("JESUS", "FEATURE_FILM", "jesus"),
    ])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "jes"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
    })
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
    })
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })

    expect(navigationMocks.push).toHaveBeenCalledWith(
      expect.stringContaining("jesus"),
    )
    expect(mockedRunSearch).not.toHaveBeenCalled()
  })

  it.each([
    ["FEATURE_FILM", "jesus"],
    ["SEGMENT", "jesus-heals"],
    ["COLLECTION", "jesus-collection"],
  ] as const)(
    "opens a tapped %s direct match only once after the compatibility click",
    async (label, slug) => {
      vi.useFakeTimers()
      mockEnglishAndSpanishSearchLanguages()
      mockedFetchSuggestions.mockResolvedValueOnce([
        watchContentMatch("JESUS", label, slug),
      ])

      const input = await openSearchOverlay()
      act(() => setInputValue(input, "jes"))
      await act(async () => {
        vi.advanceTimersByTime(180)
        await Promise.resolve()
        await Promise.resolve()
      })

      const option = document.querySelector('[role="option"]') as HTMLElement
      const dispatchTouchPointer = (type: string) => {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        })
        Object.defineProperties(event, {
          pointerId: { value: 7 },
          pointerType: { value: "touch" },
        })
        option.dispatchEvent(event)
      }

      act(() => {
        dispatchTouchPointer("pointerdown")
        dispatchTouchPointer("pointerup")
        option.click()
      })

      expect(navigationMocks.push).toHaveBeenCalledTimes(1)
      expect(navigationMocks.push).toHaveBeenCalledWith(
        expect.stringContaining(slug),
      )
      expect(mockedRunSearch).not.toHaveBeenCalled()
    },
  )

  it("discards stale suggestions when the selected language changes", async () => {
    vi.useFakeTimers()
    mockedGetSearchLanguageOptions.mockResolvedValue({
      ok: true,
      options: [englishSearchLanguage, japaneseSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    const englishSuggestions = deferred<WatchSearchSuggestion[]>()
    mockedFetchSuggestions
      .mockReturnValueOnce(englishSuggestions.promise)
      .mockResolvedValueOnce([watchSuggestion("Japanese Jesus")])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "je"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      ;(
        document.querySelector(
          '[data-testid="language-combobox-trigger"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      ;(
        document.querySelector(
          '[data-language-slug="japanese"]',
        ) as HTMLButtonElement
      ).click()
      await Promise.resolve()
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      englishSuggestions.resolve([watchSuggestion("English Jesus")])
      await englishSuggestions.promise
      await Promise.resolve()
    })

    expect(mockedFetchSuggestions).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ languageSlug: "english" }),
    )
    expect(mockedFetchSuggestions).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ languageSlug: "japanese" }),
    )
    expect(document.body.textContent).toContain("Japanese Jesus")
    expect(document.body.textContent).not.toContain("English Jesus")
    expect(mockedRunSearch).not.toHaveBeenCalled()
  })

  it("immediately searches a keyboard-selected query suggestion", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Jesus Wept"),
    ])
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

    const input = await openSearchOverlay()
    act(() => {
      setInputValue(input, "je")
    })
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      )
    })
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })

    expect(input.value).toBe("Jesus Wept")
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Jesus Wept" }),
    )

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
  })

  it("aborts superseded suggestion requests and ignores stale responses", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    const first = deferred<WatchSearchSuggestion[]>()
    const second = deferred<WatchSearchSuggestion[]>()
    mockedFetchSuggestions
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const input = await openSearchOverlay()
    act(() => {
      setInputValue(input, "je")
      vi.advanceTimersByTime(180)
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
    const firstSignal = mockedFetchSuggestions.mock.calls[0]?.[0].signal

    act(() => {
      setInputValue(input, "jes")
    })
    expect(firstSignal?.aborted).toBe(true)

    await act(async () => {
      first.resolve([watchSuggestion("Jerusalem")])
      await first.promise
      await Promise.resolve()
    })
    expect(document.body.textContent).not.toContain("Jerusalem")
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve([watchSuggestion("Jesus")])
      await second.promise
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("Jesus")
  })

  it("repopulates suggestions after backspacing word-by-word to a shorter query", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions
      .mockResolvedValueOnce([watchSuggestion("Kids story suggestion")])
      .mockResolvedValueOnce([watchSuggestion("Nazareth ministry")])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "Jesus for kids"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("Kids story suggestion")

    // Word-by-word Backspace passes through the "Jesus " -> "Jesus" state,
    // where the raw input changes but the normalized query does not.
    await act(async () => {
      setInputValue(input, "Jesus for")
      await Promise.resolve()
    })
    await act(async () => {
      setInputValue(input, "Jesus ")
      await Promise.resolve()
    })
    await act(async () => {
      setInputValue(input, "Jesus")
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(2)
    expect(mockedFetchSuggestions).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ query: "Jesus", languageSlug: "english" }),
    )
    expect(document.body.textContent).toContain("Nazareth ministry")
  })

  it("keeps suggestions visible across normalization-neutral trailing-space keystrokes", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Nazareth ministry"),
    ])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "Jesus"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("Nazareth ministry")

    await act(async () => {
      setInputValue(input, "Jesus ")
      await Promise.resolve()
    })
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    expect(document.body.textContent).toContain("Nazareth ministry")

    await act(async () => {
      setInputValue(input, "Jesus")
      await Promise.resolve()
    })
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    expect(document.body.textContent).toContain("Nazareth ministry")

    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
  })

  it("commits an in-flight response after a normalization-neutral keystroke", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    const pending = deferred<WatchSearchSuggestion[]>()
    mockedFetchSuggestions.mockReturnValueOnce(pending.promise)

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "Jesus "))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
    expect(mockedFetchSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Jesus" }),
    )

    await act(async () => {
      setInputValue(input, "Jesus")
      await Promise.resolve()
    })
    await act(async () => {
      pending.resolve([watchSuggestion("Nazareth ministry")])
      await pending.promise
      await Promise.resolve()
    })

    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("Nazareth ministry")
  })

  it("never displays a resolved response for a query edited away mid-flight", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    const stale = deferred<WatchSearchSuggestion[]>()
    mockedFetchSuggestions
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([watchSuggestion("Fresh Jesu match")])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "Jesus for"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)

    await act(async () => {
      setInputValue(input, "Jesu")
      await Promise.resolve()
    })
    await act(async () => {
      stale.resolve([watchSuggestion("Stale for-query match")])
      await stale.promise
      await Promise.resolve()
    })
    expect(document.body.textContent).not.toContain("Stale for-query match")

    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("Fresh Jesu match")
    expect(document.body.textContent).not.toContain("Stale for-query match")
  })

  it("issues one debounced fetch for character-by-character typing", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Nazareth ministry"),
    ])

    const input = await openSearchOverlay()
    for (const value of ["J", "Je", "Jes", "Jesu", "Jesus"]) {
      await act(async () => {
        setInputValue(input, value)
        await Promise.resolve()
      })
    }
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
    expect(mockedFetchSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Jesus" }),
    )
    expect(document.body.textContent).toContain("Nazareth ministry")
  })

  it("keeps suggestions visible when a keystroke lands beyond the normalization cap", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Capped-query suggestion"),
    ])
    const cappedQuery = "a".repeat(MAX_WATCH_SEARCH_QUERY_CODE_POINTS)

    const input = await openSearchOverlay()
    act(() => setInputValue(input, cappedQuery))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("Capped-query suggestion")

    // Appending past the cap changes the raw input but not the normalized
    // query — pins the guard to normalizeWatchSearchQuery identity rather
    // than a trailing-whitespace heuristic.
    await act(async () => {
      setInputValue(input, `${cappedQuery}a`)
      await Promise.resolve()
    })
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    expect(document.body.textContent).toContain("Capped-query suggestion")

    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)
  })

  it("discards an in-flight response when a real edit follows a neutral keystroke", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    const stale = deferred<WatchSearchSuggestion[]>()
    mockedFetchSuggestions
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([watchSuggestion("Fresh x match")])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "Jesus"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(1)

    await act(async () => {
      setInputValue(input, "Jesus ")
      await Promise.resolve()
    })
    await act(async () => {
      setInputValue(input, "Jesus x")
      await Promise.resolve()
    })
    await act(async () => {
      stale.resolve([watchSuggestion("Stale bare-query match")])
      await stale.promise
      await Promise.resolve()
    })
    expect(document.body.textContent).not.toContain("Stale bare-query match")

    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledTimes(2)
    expect(mockedFetchSuggestions).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ query: "Jesus x" }),
    )
    expect(document.body.textContent).toContain("Fresh x match")
    expect(document.body.textContent).not.toContain("Stale bare-query match")
  })

  it("does not reopen suggestions after submitting a draft longer than the request cap", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Late suggestion"),
    ])
    const longQuery = `${"j".repeat(200)}extra`

    const input = await openSearchOverlay()
    await submitSearch(input, longQuery)
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "j".repeat(200) }),
    )
    expect(mockedFetchSuggestions).not.toHaveBeenCalled()
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it("keeps resolved suggestions hidden when close is immediately reversed", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([watchSuggestion("Jesus")])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "je"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()

    const close = document.querySelector(
      '[data-testid="floating-header-search-close"]',
    ) as HTMLButtonElement
    const searchButton = document.querySelector(
      '[aria-label="Search videos"]',
    ) as HTMLButtonElement
    await act(async () => {
      close.click()
      searchButton.click()
      await Promise.resolve()
    })

    expect(input.value).toBe("")
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(input.getAttribute("aria-expanded")).toBe("false")
  })

  it("defers suggestions during composition and lets Escape dismiss suggestions before the modal", async () => {
    vi.useFakeTimers()
    mockedGetSearchLanguageOptions.mockResolvedValue({
      ok: true,
      options: [japaneseSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: japaneseSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    mockedFetchSuggestions.mockResolvedValueOnce([watchSuggestion("日本語")])

    const input = await openSearchOverlay()
    act(() => {
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      )
      setInputValue(input, "日本")
      vi.advanceTimersByTime(180)
    })
    expect(mockedFetchSuggestions).not.toHaveBeenCalled()

    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    })
    act(() => {
      input.dispatchEvent(composingEnter)
    })
    expect(composingEnter.defaultPrevented).toBe(true)
    expect(mockedRunSearch).not.toHaveBeenCalled()

    act(() => {
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockedFetchSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ query: "日本", languageSlug: "japanese" }),
    )
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(
      document.querySelector('[aria-label="Search and browse videos"]'),
    ).not.toBeNull()

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(
      document.querySelector('[aria-label="Search and browse videos"]')
        ?.className,
    ).toContain("animate-overlay-fade-out")
  })

  it("immediately searches a pointer-selected query suggestion", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([watchSuggestion("Jesus")])

    const input = await openSearchOverlay()
    act(() => {
      setInputValue(input, "je")
    })
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    const option = document.querySelector('[role="option"]')
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      option?.dispatchEvent(pointerDown)
    })
    expect(mockedRunSearch).not.toHaveBeenCalled()

    await act(async () => {
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(pointerDown.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe("Jesus")
    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Jesus" }),
    )
  })

  it("lets touch users scroll suggestions before selecting a stationary tap", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedFetchSuggestions.mockResolvedValueOnce([
      watchSuggestion("Jesus"),
      watchSuggestion("Jesus Wept"),
    ])

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "je"))
    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })

    const options = document.querySelectorAll('[role="option"]')
    const dispatchTouchPointer = (
      target: Element,
      type: string,
      clientY: number,
    ) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY,
      })
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: "touch" },
      })
      target.dispatchEvent(event)
      return event
    }

    act(() => {
      dispatchTouchPointer(options[0]!, "pointerdown", 10)
      dispatchTouchPointer(options[0]!, "pointermove", 40)
      dispatchTouchPointer(options[0]!, "pointerup", 40)
    })
    expect(input.value).toBe("je")
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()

    await act(async () => {
      dispatchTouchPointer(options[1]!, "pointerdown", 60)
      dispatchTouchPointer(options[1]!, "pointerup", 60)
      ;(options[1] as HTMLElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(input.value).toBe("Jesus Wept")
    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Jesus Wept" }),
    )
  })

  it("keeps no-results copy tied to the last submitted query", async () => {
    mockedRunSearch.mockResolvedValueOnce(
      searchResult("watch-search", { query: "jesus" }),
    )

    const input = await openSearchOverlay()
    await submitSearch(input, "jesus")

    expect(document.body.textContent).toContain('No results for "jesus"')

    act(() => {
      setInputValue(input, "an unsubmitted draft")
    })

    expect(document.body.textContent).toContain('No results for "jesus"')
    expect(document.body.textContent).not.toContain(
      'No results for "an unsubmitted draft"',
    )
  })

  it("shows wait-and-retry guidance for a rate-limited search", async () => {
    mockedRunSearch.mockRejectedValueOnce({ kind: "rate_limited" })

    const input = await openSearchOverlay()
    await submitSearch(input, "jesus")

    expect(document.body.textContent).toContain(
      "Too many requests. Please try again in a minute.",
    )
    expect(document.body.textContent).not.toContain(
      "Please check your connection and try again.",
    )
  })

  it("localizes rate-limit guidance for Simplified Chinese", async () => {
    mockedRunSearch.mockRejectedValueOnce({ kind: "rate_limited" })

    const input = await openSearchOverlay("zh-Hans")
    await submitSearch(input, "jesus")

    expect(document.body.textContent).toContain(
      "请求过于频繁，请一分钟后重试。",
    )
    expect(document.body.textContent).not.toContain(
      "Please check your connection and try again.",
    )
  })

  it("reserves connection guidance for a network search failure", async () => {
    mockedRunSearch.mockRejectedValueOnce({ kind: "network_error" })

    const input = await openSearchOverlay()
    await submitSearch(input, "jesus")

    expect(document.body.textContent).toContain(
      "Please check your connection and try again.",
    )
    expect(document.body.textContent).not.toContain(
      "Too many requests. Please try again in a minute.",
    )
  })

  it.each(["server_error", "unknown"] as const)(
    "keeps %s search guidance neutral",
    async (kind) => {
      mockedRunSearch.mockRejectedValueOnce({ kind })

      const input = await openSearchOverlay()
      await submitSearch(input, "jesus")

      expect(document.body.textContent).not.toContain(
        "Please check your connection and try again.",
      )
      expect(document.body.textContent).not.toContain(
        "Too many requests. Please try again in a minute.",
      )
    },
  )

  it("closes search without navigating when the header logo is clicked", async () => {
    vi.useFakeTimers()
    await openSearchOverlay()

    const logo = document.querySelector(
      '[data-testid="floating-header-logo"]',
    ) as HTMLAnchorElement | null
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })

    expect(logo).not.toBeNull()
    const navigationAllowed = await act(() => logo!.dispatchEvent(click))

    expect(navigationAllowed).toBe(false)
    expect(click.defaultPrevented).toBe(true)
    expect(logo?.getAttribute("aria-label")).toBe("Close search")
    expect(
      document.querySelector('[aria-label="Search and browse videos"]')
        ?.className,
    ).toContain("animate-overlay-fade-out")

    const closingClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })
    const closingNavigationAllowed = await act(() =>
      logo!.dispatchEvent(closingClick),
    )

    expect(closingNavigationAllowed).toBe(false)
    expect(closingClick.defaultPrevented).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(220)
      await Promise.resolve()
    })

    expect(
      document.querySelector('[aria-label="Search and browse videos"]'),
    ).toBeNull()
  })

  it("localizes the global search launcher and close control in Russian", async () => {
    setRequestLocale("ru")
    mockedRunSearch.mockResolvedValueOnce(
      searchResult("watch-search", {
        resolvedLanguage: {
          locale: "ru",
          publicSlug: "russian",
          englishName: "Russian",
          source: "explicit-selection",
        },
      }),
    )
    mockedGetSearchLanguageOptions.mockResolvedValue({
      ok: true,
      options: [russianSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: russianSearchLanguage,
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
      '[aria-label="Искать видео"]',
    ) as HTMLButtonElement
    await act(async () => {
      searchButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      document.querySelector('[aria-label="Закрыть поиск"]'),
    ).not.toBeNull()
    expect(document.querySelector('[aria-label="Search videos"]')).toBeNull()
    expect(document.querySelector('[aria-label="Close search"]')).toBeNull()

    await flushSearchControllerMount()
    expect(
      document.querySelector('[data-testid="searching-in-language-label"]')
        ?.textContent,
    ).toBe("русский")
    expect(
      document.querySelector('[data-testid="search-language-context"]')
        ?.textContent,
    ).toBe("Язык поиска: русский")

    const input = document.querySelector(
      'input[aria-label="Искать видео по ключевым словам"]',
    ) as HTMLInputElement
    act(() => setInputValue(input, "иисус"))

    const contextualSubmit = document.querySelector(
      '[data-testid="search-context-submit"]',
    ) as HTMLButtonElement
    expect(contextualSubmit.getAttribute("aria-label")).toBe(
      "Поиск на русском по запросу «иисус»",
    )

    await act(async () => {
      contextualSubmit.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushResolvedSearch()

    expect(
      document.querySelector('[data-testid="search-language-context"]')
        ?.textContent,
    ).toBe("Результаты на русском")
  })

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

  it("focuses the instant-shell input as soon as the first-open shell mounts", () => {
    vi.useFakeTimers()

    act(() => {
      root.render(
        <SearchOverlayInstantShell
          open
          closing={false}
          query=""
          setOpen={vi.fn()}
          setQuery={vi.fn()}
          onSubmit={vi.fn()}
          headerTopClass={FLOATING_HEADER_TOP_CLASS}
          logoSlotClass="w-12"
          headerLanguageControlVisible={false}
        />,
      )
    })

    const input = document.querySelector(
      'input[aria-label="Search videos by keyword"]',
    )
    expect(document.activeElement).toBe(input)
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

    const instantShell = document.querySelector(
      '[data-testid="search-overlay-instant-shell"]',
    )
    const instantInput = instantShell?.querySelector(
      'input[aria-label="Search videos by keyword"]',
    )
    expect(instantInput).not.toBeNull()
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
    const languageButton = document.querySelector(
      '[data-testid="floating-header-language-button"]',
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
    expect(overlayFieldShell?.className).not.toContain("col-span-2")
    expect(header?.className).toContain(FLOATING_MODAL_HEADER_LAYOUT_CLASS)
    expect(header?.className).toContain("translate-y-0")
    expect(languageButton?.className).toContain(
      FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS,
    )
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
    vi.useFakeTimers()
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
      vi.advanceTimersByTime(220)
      await Promise.resolve()
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
    vi.useFakeTimers()
    const input = await openSearchOverlay()
    act(() => {
      setInputValue(input, "jesus")
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    await act(async () => {
      vi.advanceTimersByTime(220)
      await Promise.resolve()
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
    const delayedSearch = deferred<MockSearchResponse>()
    mockedRunSearch.mockReturnValueOnce(delayedSearch.promise)

    const input = await openSearchOverlay()
    await submitSearch(input, "jesus")

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
    expect(mockedRunSearch).not.toHaveBeenCalled()
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
    expect(bottomBackdrop).toBeNull()
    expect(scrollBody?.className).toContain("z-1")
    expect(scrollBody?.className).toContain("top-44")
    expect(scrollBody?.className).toContain("md:top-32")
    expect(scrollBody?.className).toContain("bottom-0")
    expect(overlayField).not.toBeNull()
    expect(overlayFieldShell?.className).toContain("min-w-0")
    expect(overlayFieldShell?.className).toContain("w-full")
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

  it("mirrors the global header language switcher trailing slot", async () => {
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

describe("FloatingSearchProvider — search language selection", () => {
  it("searches a foreign-language query immediately without a detection confirmation", async () => {
    vi.useFakeTimers()
    mockEnglishAndSpanishSearchLanguages()
    mockedRunSearch.mockResolvedValueOnce(
      searchResult("watch-search", {
        results: [makeSearchResult("spanish-result", "Spanish Result")],
        query: SPANISH_CONFIRMATION_QUERY,
      }),
    )

    const input = await openSearchOverlay()
    await submitSearch(input, SPANISH_CONFIRMATION_QUERY)

    expect(document.body.textContent).not.toContain("Spanish detected")
    expect(document.body.textContent).not.toContain("Search in Spanish")
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        query: SPANISH_CONFIRMATION_QUERY,
      }),
    )
    expect(document.body.textContent).toContain("Spanish Result")
  })

  it("searches Han-script input in the manually selected language", async () => {
    vi.useFakeTimers()
    mockedGetSearchLanguageOptions.mockResolvedValue({
      ok: true,
      options: [englishSearchLanguage, japaneseSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    mockedRunSearch.mockResolvedValueOnce(
      searchResult("watch-search", {
        results: [makeSearchResult("japanese-result", "Japanese Result")],
        query: "日本",
      }),
    )

    const input = await openSearchOverlay()
    const languageTrigger = document.querySelector(
      '[data-testid="language-combobox-trigger"]',
    ) as HTMLButtonElement
    await act(async () => {
      languageTrigger.click()
      await Promise.resolve()
    })
    const japaneseOption = document.querySelector(
      '[data-language-slug="japanese"]',
    ) as HTMLButtonElement
    await act(async () => {
      japaneseOption.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await submitSearch(input, "日本")

    expect(document.querySelector('[role="status"]')).toBeNull()
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        languageContext: expect.objectContaining({
          targetLanguageSlug: "japanese",
        }),
        query: "日本",
      }),
    )
    expect(document.body.textContent).toContain("Japanese Result")
  })

  it("keeps an unavailable recovery card in the completed mixed result window", async () => {
    vi.useFakeTimers()
    mockedGetSearchLanguageOptions.mockResolvedValue({
      ok: true,
      options: [
        englishSearchLanguage,
        spanishSearchLanguage,
        japaneseSearchLanguage,
      ],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    mockedRunSearch.mockResolvedValueOnce({
      ...makeSearchResponse(
        [
          {
            ...makeSearchResult("playable-before", "Playable Before"),
            availabilityKind: "target_audio",
            languageSlug: "spanish-castilian",
          },
          {
            ...makeSearchResult("unavailable-result", "Unavailable Result"),
            availabilityKind: "unavailable",
            languageSlug: null,
          },
          {
            ...makeSearchResult("playable-after", "Playable After"),
            availabilityKind: "target_subtitle",
            languageSlug: "english",
            subtitleLanguageSlug: "spanish-castilian",
          },
        ],
        false,
      ),
      targetLanguageSlug: "spanish-castilian",
    })

    const input = await openSearchOverlay()
    await submitSearch(input, "jesus")

    const resultLinks = Array.from(document.querySelectorAll("a")).filter(
      (anchor) =>
        ["Playable Before", "Unavailable Result", "Playable After"].some(
          (title) => anchor.textContent?.includes(title) ?? false,
        ),
    ) as HTMLAnchorElement[]
    const visibleResultIds = [
      "playable-before",
      "unavailable-result",
      "playable-after",
    ]
    expect(resultLinks.map((anchor) => anchor.textContent)).toEqual([
      expect.stringContaining("Playable Before"),
      expect.stringContaining("Unavailable Result"),
      expect.stringContaining("Playable After"),
    ])

    const resultLink = resultLinks[1]
    expect(resultLink).toBeDefined()
    expect(resultLink.getAttribute("href")).toBe(
      "/unavailable-result-slug.html/spanish-castilian.html",
    )
    expect(
      resultLink.querySelector('[data-testid="search-card-availability-badge"]')
        ?.textContent,
    ).toBe(
      `${englishMessages.LanguagePickerModal.notAvailable} · European Spanish`,
    )
    expect(
      resultLinks[0]?.querySelector(
        '[data-testid="search-card-availability-badge"]',
      ),
    ).toBeNull()
    expect(
      resultLinks[2]?.querySelector(
        '[data-testid="search-card-availability-badge"]',
      ),
    ).toBeNull()
    expect(recordWatchSearchResultsViewed).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleResultIds,
      }),
    )

    const languageTrigger = document.querySelector(
      '[data-testid="language-combobox-trigger"]',
    ) as HTMLButtonElement
    await act(async () => {
      languageTrigger.click()
      await Promise.resolve()
    })
    const japaneseOption = document.querySelector(
      '[data-language-slug="japanese"]',
    ) as HTMLButtonElement
    await act(async () => {
      japaneseOption.click()
      await Promise.resolve()
    })

    expect(resultLink.getAttribute("href")).toBe(
      "/unavailable-result-slug.html/spanish-castilian.html",
    )
    await act(async () => {
      resultLink.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      )
      await Promise.resolve()
    })
    const stored = JSON.parse(
      window.sessionStorage.getItem(WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY) ??
        "null",
    ) as { target?: { requestedLanguageSlug?: string } } | null
    expect(stored?.target?.requestedLanguageSlug).toBe("spanish-castilian")
    expect(recordWatchSearchResultClick).toHaveBeenCalledWith(
      expect.objectContaining({
        resultId: "unavailable-result",
        position: 2,
        visibleResultIds,
      }),
    )
  })

  it("keeps language changes draft-only until explicit submit", async () => {
    vi.useFakeTimers()
    mockedGetSearchLanguageOptions.mockResolvedValue({
      ok: true,
      options: [englishSearchLanguage, japaneseSearchLanguage],
      countrySuggestion: null,
      recommendedLanguage: englishSearchLanguage,
      countryCode: null,
      countryName: null,
    })
    mockedRunSearch.mockResolvedValueOnce(searchResult("watch-search"))

    const input = await openSearchOverlay()
    act(() => setInputValue(input, "jesus"))
    const languageTrigger = document.querySelector(
      '[data-testid="language-combobox-trigger"]',
    ) as HTMLButtonElement
    await act(async () => {
      languageTrigger.click()
      await Promise.resolve()
    })
    const japaneseOption = document.querySelector(
      '[data-language-slug="japanese"]',
    ) as HTMLButtonElement
    await act(async () => {
      japaneseOption.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(input.value).toBe("jesus")
    expect(mockedRunSearch).not.toHaveBeenCalled()

    await act(async () => {
      input.form?.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockedRunSearch).toHaveBeenCalledTimes(1)
    expect(mockedRunSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        languageContext: expect.objectContaining({
          targetLanguageSlug: "japanese",
        }),
        query: "jesus",
      }),
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
    await submitSearch(input, "the bible project")

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
    await submitSearch(input, "the bible project")

    const link = Array.from(document.querySelectorAll("a")).find(
      (anchor) => anchor.getAttribute("href") === "/first-result-slug.html",
    )
    const searchRequestId =
      mockedRunSearch.mock.calls[0]?.[0].languageContext?.clientRequestId

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

    expect(input.value).toBe("the bible project")
    await act(async () => {
      vi.advanceTimersByTime(0)
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
      await submitSearch(input, "jesus")
      expect(document.body.textContent).toContain("Jesus Result")

      act(() => {
        setInputValue(input, "the bible proj")
        vi.advanceTimersByTime(360)
      })

      expect(window.location.search).toBe("?utm=campaign")
      expect(mockedRunSearch).toHaveBeenCalledTimes(1)

      act(() => {
        setInputValue(input, "the bible project")
        vi.advanceTimersByTime(300)
      })
      expect(mockedRunSearch).toHaveBeenCalledTimes(1)

      await act(async () => {
        input.form?.requestSubmit()
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
    await submitSearch(input, "the bible project")

    act(() => {
      setInputValue(input, "a different draft")
    })
    expect(mockedRunSearch).toHaveBeenCalledTimes(1)

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

  it("shows rate-limit guidance when loading more results is throttled", async () => {
    vi.useFakeTimers()
    mockedRunSearch
      .mockResolvedValueOnce(
        makeSearchResponse(
          [makeSearchResult("initial-1", "Initial Result")],
          true,
        ),
      )
      .mockRejectedValueOnce({ kind: "rate_limited" })

    const input = await openSearchOverlay()
    await submitSearch(input, "jesus")

    const loadMore = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Load more",
    )
    act(() => loadMore?.click())
    await flushResolvedSearch()

    expect(document.body.textContent).toContain("Initial Result")
    expect(document.body.textContent).toContain(
      "Too many requests. Please try again in a minute.",
    )
    expect(document.body.textContent).not.toContain(
      "Please check your connection and try again.",
    )
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
        languageContext: expect.objectContaining({
          targetLanguageSlug: null,
        }),
      }),
    )
  })
})
