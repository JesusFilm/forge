"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { useTranslations } from "next-intl"
import {
  ChevronDown,
  ChevronUp,
  Globe2,
  Languages,
  Search as SearchIcon,
  X,
} from "lucide-react"

import { useFloatingSearch } from "./FloatingSearchContext"
import { FloatingSearchFieldInput } from "./FloatingSearchField"
import { CATEGORY_ICON_BY_SEARCH_TERM } from "./SearchCategoryIcons"
import { VideoCard } from "./search/VideoCard"
import { reportDatadogRumAction } from "@/components/DatadogRum"
import { SpinnerIcon } from "@/components/ui/spinner"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"
import { CATEGORIES } from "@/lib/search-categories"
import { SEARCH_OVERLAY_FIELD_WIDTH_CLASSES } from "@/lib/content-width"
import type { CategorySearchTerm } from "@/lib/search-categories"
import {
  MAX_SEARCH_LANGUAGE_FILTERS,
  type SearchLanguageOption,
} from "@/lib/search-language"
import { detectQueryLanguageSuggestion } from "@/lib/search-query-language"
import { WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION } from "@/lib/watch-search-analytics-contract"
import { buildWatchSearchResultClickRumContext } from "@/lib/watch-search-rum"

const CATEGORY_TITLE_KEYS: Record<
  CategorySearchTerm,
  | "categoryBibleStories"
  | "categoryParables"
  | "categoryAnimated"
  | "categoryStudy"
  | "categoryFamily"
  | "categoryChristmas"
> = {
  "bible stories": "categoryBibleStories",
  parables: "categoryParables",
  animated: "categoryAnimated",
  study: "categoryStudy",
  family: "categoryFamily",
  christmas: "categoryChristmas",
}

const ALGOLIA_SEARCH_SUGGESTIONS = [
  "Jesus",
  "Bible",
  "Gospel",
  "Faith",
  "Prayer",
  "Hope",
  "Love",
  "Christian",
] as const

const ALGOLIA_REGION_ORDER = [
  "Europe",
  "Africa",
  "Asia",
  "South America",
  "North America",
  "Oceania",
] as const

type AlgoliaBrowseTab = "suggestions" | "languages"
const SEARCH_LANGUAGE_METADATA_FALLBACK_MS = 1200

export function SearchOverlay() {
  const t = useTranslations("SearchOverlay")
  const {
    open,
    closing,
    query,
    displayResults,
    exiting,
    resultsKey,
    hasMore,
    loading,
    showSkeleton,
    loadingMore,
    error,
    searched,
    algoliaSearchEnabled,
    languageOptions,
    languageGroups,
    languageCountrySuggestion,
    recommendedLanguage,
    languageOptionsLoaded,
    languageOptionsLoading,
    languageOptionsError,
    selectedLanguageEnglishNames,
    selectedLanguageRegionByName,
    selectedSearchLanguageOption,
    searchResultAnalytics,
    defaultSearchLanguageOption,
    setQuery,
    search,
    loadMore,
    toggleSearchLanguage,
    selectSearchLanguage,
    resetSearchLanguageToDefault,
    clearSearchLanguages,
    closeAndKeepQuery,
  } = useFloatingSearch()

  const overlayRef = useRef<HTMLDivElement>(null)
  const [closePortalContainer, setClosePortalContainer] =
    useState<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSearchAfterLanguageLoadRef = useRef<string | null>(null)
  const [languagePanelCollapsed, setLanguagePanelCollapsed] = useState(true)
  const [algoliaBrowseTab, setAlgoliaBrowseTab] =
    useState<AlgoliaBrowseTab>("languages")
  const [selectedRegionName, setSelectedRegionName] = useState<string | null>(
    null,
  )
  const [languageAutocompleteOpen, setLanguageAutocompleteOpen] =
    useState(false)
  const [languageMetadataFallbackReady, setLanguageMetadataFallbackReady] =
    useState(false)

  const orderedLanguageGroups = useMemo(() => {
    const order = new Map<string, number>(
      ALGOLIA_REGION_ORDER.map((regionName, index) => [regionName, index]),
    )
    return [...languageGroups].sort((a, b) => {
      const aOrder = order.get(a.regionName) ?? Number.MAX_SAFE_INTEGER
      const bOrder = order.get(b.regionName) ?? Number.MAX_SAFE_INTEGER
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.regionName.localeCompare(b.regionName)
    })
  }, [languageGroups])

  const activeRegionName = orderedLanguageGroups.some(
    (group) => group.regionName === selectedRegionName,
  )
    ? selectedRegionName
    : (orderedLanguageGroups[0]?.regionName ?? null)

  const setOverlayElement = useCallback((node: HTMLDivElement | null) => {
    overlayRef.current = node
    setClosePortalContainer(node)
  }, [])

  // Autofocus the input shortly after user-open.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [open])

  // Escape closes the modal while preserving the in-memory query state.
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndKeepQuery()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, closeAndKeepQuery])

  // Body scroll lock — prevents the page behind from scrolling while modal open.
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  // Focus trap — keep Tab cycling inside the overlay.
  useEffect(() => {
    if (!open) return
    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return
      const overlay = overlayRef.current
      if (!overlay) return
      const focusable = overlay.querySelectorAll<HTMLElement>(
        'input, button, a[href], [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", handleTab)
    return () => document.removeEventListener("keydown", handleTab)
  }, [open])

  // Cleanup debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const semanticSearchEnabled = !algoliaSearchEnabled
  const languageOptionsReadyForSearch =
    !semanticSearchEnabled ||
    languageOptionsLoaded ||
    languageMetadataFallbackReady

  useEffect(() => {
    if (!open || !semanticSearchEnabled || languageOptionsLoaded) return
    const fallbackTimer = setTimeout(() => {
      setLanguageMetadataFallbackReady(true)
    }, SEARCH_LANGUAGE_METADATA_FALLBACK_MS)
    return () => {
      clearTimeout(fallbackTimer)
      setLanguageMetadataFallbackReady(false)
    }
  }, [languageOptionsLoaded, open, semanticSearchEnabled])

  const maybeDetectQueryLanguageSuggestion = useCallback(
    (value: string) => {
      if (!semanticSearchEnabled) return null
      return detectQueryLanguageSuggestion({
        query: value,
        currentLanguageSlug: selectedSearchLanguageOption?.publicSlug ?? null,
        languageOptions,
      })
    },
    [languageOptions, selectedSearchLanguageOption, semanticSearchEnabled],
  )
  const queryLanguageSuggestion = useMemo(
    () => maybeDetectQueryLanguageSuggestion(query),
    [maybeDetectQueryLanguageSuggestion, query],
  )
  const suggestedLanguageName =
    queryLanguageSuggestion?.option.englishName.split(",")[0] ?? null

  useEffect(() => {
    if (!languageOptionsReadyForSearch) return
    const pendingQuery = pendingSearchAfterLanguageLoadRef.current
    if (pendingQuery == null || pendingQuery !== query) return
    pendingSearchAfterLanguageLoadRef.current = null
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (pendingQuery.trim().length === 0) return
    if (
      semanticSearchEnabled &&
      maybeDetectQueryLanguageSuggestion(pendingQuery)
    ) {
      return
    }
    debounceRef.current = setTimeout(() => {
      void search(pendingQuery)
    }, 300)
  }, [
    languageOptionsReadyForSearch,
    maybeDetectQueryLanguageSuggestion,
    query,
    search,
    semanticSearchEnabled,
  ])

  const handleQueryLanguageSuggestionConfirm = useCallback(() => {
    const suggestion = queryLanguageSuggestion
    if (!suggestion?.option.publicSlug) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    pendingSearchAfterLanguageLoadRef.current = null
    selectSearchLanguage(suggestion.option, suggestion.option.regionNames[0])
    void search(query, {
      languageEnglishNames: [suggestion.option.englishName],
      languageSlug: suggestion.option.publicSlug,
    })
  }, [query, queryLanguageSuggestion, search, selectSearchLanguage])

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setQuery(newValue)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!languageOptionsReadyForSearch) {
        pendingSearchAfterLanguageLoadRef.current = newValue
        return
      }
      pendingSearchAfterLanguageLoadRef.current = null
      if (maybeDetectQueryLanguageSuggestion(newValue)) return
      debounceRef.current = setTimeout(() => {
        void search(newValue)
      }, 300)
    },
    [
      languageOptionsReadyForSearch,
      maybeDetectQueryLanguageSuggestion,
      setQuery,
      search,
    ],
  )

  const handleInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return
      e.preventDefault()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!languageOptionsReadyForSearch) {
        pendingSearchAfterLanguageLoadRef.current = query
        return
      }
      pendingSearchAfterLanguageLoadRef.current = null
      if (queryLanguageSuggestion) {
        handleQueryLanguageSuggestionConfirm()
        return
      }
      void search(query)
    },
    [
      handleQueryLanguageSuggestionConfirm,
      languageOptionsReadyForSearch,
      query,
      queryLanguageSuggestion,
      search,
    ],
  )

  const handleCategoryClick = useCallback(
    (searchTerm: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      pendingSearchAfterLanguageLoadRef.current = null
      void search(searchTerm)
    },
    [search],
  )

  const handleSuggestionClick = useCallback(
    (searchTerm: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      pendingSearchAfterLanguageLoadRef.current = null
      if (recommendedLanguage) {
        selectSearchLanguage(
          recommendedLanguage,
          recommendedLanguage.regionNames[0],
        )
        void search(searchTerm, {
          languageEnglishNames: [recommendedLanguage.englishName],
        })
        return
      }
      void search(searchTerm)
    },
    [recommendedLanguage, search, selectSearchLanguage],
  )

  const handleRecommendedLanguageClick = useCallback(() => {
    if (!recommendedLanguage) return
    pendingSearchAfterLanguageLoadRef.current = null
    selectSearchLanguage(
      recommendedLanguage,
      recommendedLanguage.regionNames[0],
    )
    if (query.trim().length > 0) {
      void search(query, {
        languageEnglishNames: [recommendedLanguage.englishName],
      })
    }
  }, [query, recommendedLanguage, search, selectSearchLanguage])

  const handleSemanticLanguageClick = useCallback(
    (language: SearchLanguageOption, regionName?: string) => {
      if (!language.publicSlug) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      pendingSearchAfterLanguageLoadRef.current = null
      setLanguageAutocompleteOpen(false)
      selectSearchLanguage(language, regionName)
      if (query.trim().length > 0) {
        void search(query, {
          languageEnglishNames: [language.englishName],
          languageSlug: language.publicSlug,
        })
      }
    },
    [query, search, selectSearchLanguage],
  )

  const handleResetSearchLanguage = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    pendingSearchAfterLanguageLoadRef.current = null
    setLanguageAutocompleteOpen(false)
    resetSearchLanguageToDefault()
  }, [resetSearchLanguageToDefault])

  const handleClearInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    pendingSearchAfterLanguageLoadRef.current = null
    void search("")
    inputRef.current?.focus()
  }, [search])

  const showCategoryGrid =
    !algoliaSearchEnabled && query.trim().length === 0 && !loading && !searched
  const searchLanguageControlVisible =
    algoliaSearchEnabled ||
    languageOptionsLoading ||
    languageOptions.length > 0 ||
    languageOptionsError != null
  const languagePanelOpen =
    open &&
    algoliaSearchEnabled &&
    searchLanguageControlVisible &&
    !languagePanelCollapsed
  const showLanguageBrowsePanel =
    algoliaSearchEnabled &&
    searchLanguageControlVisible &&
    (languagePanelOpen || query.trim().length === 0)
  const activeRegionGroup =
    orderedLanguageGroups.find(
      (group) => group.regionName === activeRegionName,
    ) ??
    orderedLanguageGroups[0] ??
    null
  const searchOverlayScrollTopClass = queryLanguageSuggestion
    ? "top-72 md:top-60"
    : searchLanguageControlVisible
      ? "top-60 md:top-48"
      : "top-44 md:top-32"
  const languageCountLabel = new Intl.NumberFormat().format(
    languageOptions.length,
  )
  const algoliaSelectedLanguageSummary =
    selectedLanguageEnglishNames.length === 0
      ? t("allLanguages")
      : selectedLanguageEnglishNames
          .slice(0, 2)
          .map((language) => language.split(",")[0])
          .join(", ")
  const selectedSearchLanguageName =
    selectedSearchLanguageOption?.englishName.split(",")[0] ??
    defaultSearchLanguageOption?.englishName.split(",")[0] ??
    recommendedLanguage?.englishName.split(",")[0] ??
    null
  const selectedLanguageSummary = algoliaSearchEnabled
    ? algoliaSelectedLanguageSummary
    : (selectedSearchLanguageName ?? t("searchLanguageLabel"))
  const additionalLanguageCount = Math.max(
    0,
    selectedLanguageEnglishNames.length - 2,
  )
  const languageSelectionAtLimit =
    selectedLanguageEnglishNames.length >= MAX_SEARCH_LANGUAGE_FILTERS
  const recommendedLanguageName =
    recommendedLanguage?.englishName.split(",")[0] ?? null
  const semanticLanguageOverrideActive =
    semanticSearchEnabled &&
    (selectedSearchLanguageOption?.publicSlug ?? null) !==
      (defaultSearchLanguageOption?.publicSlug ?? null)
  const semanticLanguageTriggerClassName = [
    "!h-[52px] !min-h-[52px] !rounded-[35px] !border-0 !bg-white !text-stone-950 shadow-xl hover:!bg-stone-50 focus-visible:ring-stone-950/20 md:!rounded-l-none md:!rounded-r-[35px] md:!border-y-0 md:!border-r-0 md:!border-l md:!border-stone-200 md:!shadow-none",
    semanticLanguageOverrideActive ? "pr-14" : null,
  ]
    .filter(Boolean)
    .join(" ")
  const semanticLanguageComboboxOptions = useMemo<LanguageComboboxOption[]>(
    () =>
      languageOptions.flatMap((language) =>
        language.publicSlug
          ? [
              {
                slug: language.publicSlug,
                name: language.englishName,
                nativeName: language.nativeName,
                bcp47: language.bcp47,
              },
            ]
          : [],
      ),
    [languageOptions],
  )
  const semanticLanguageOptionBySlug = useMemo(() => {
    const bySlug = new Map<string, SearchLanguageOption>()
    for (const language of languageOptions) {
      if (language.publicSlug) bySlug.set(language.publicSlug, language)
    }
    return bySlug
  }, [languageOptions])
  const semanticLanguageComboboxValue =
    selectedSearchLanguageOption?.publicSlug ??
    defaultSearchLanguageOption?.publicSlug ??
    recommendedLanguage?.publicSlug ??
    ""

  const handleLanguagePanelToggle = useCallback(() => {
    setLanguagePanelCollapsed((collapsed) => {
      const nextCollapsed = !collapsed
      if (nextCollapsed) {
        setLanguageAutocompleteOpen(false)
      } else {
        setLanguageAutocompleteOpen(true)
      }
      return nextCollapsed
    })
  }, [])

  const handleSemanticLanguageSlugChange = useCallback(
    (slug: string) => {
      const language = semanticLanguageOptionBySlug.get(slug)
      if (!language) return
      handleSemanticLanguageClick(language, language.regionNames[0])
    },
    [handleSemanticLanguageClick, semanticLanguageOptionBySlug],
  )

  return (
    <div
      ref={setOverlayElement}
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
      className={`fixed inset-0 h-dvh min-h-dvh overflow-visible ${closing ? "animate-overlay-fade-out" : "animate-overlay-fade-in"}`}
      style={{
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Floating top bar: input is viewport-centered via mx-auto. On mobile
          the logo is in normal flow above the field so it cannot overlap the
          input. Outer padding (px-4 sm:px-6) matches the
          floating searchbar's side margin (w-[calc(100%-2rem)]
          sm:w-[calc(100%-3rem)]) so the input's position and size on open
          match the bar's exactly. The padding-top mirrors the header bar's
          unpinned top offset, including safe-area inset and the md breakpoint,
          so the modal input does not drift vertically when opened. The wrapper
          is `pointer-events-none` so scroll wheel events over the empty edges
          pass through to the body; the pill + logo + close button re-enable
          pointer events on themselves. */}
      <div
        data-testid="search-overlay-top-bar"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-[calc(env(safe-area-inset-top,0px)+2rem)] sm:px-6 md:pt-[calc(env(safe-area-inset-top,0px)+3rem)]"
      >
        <Link
          href={"/" as Route}
          aria-label={t("home")}
          // stopPropagation keeps the overlay from intercepting the click as
          // a backdrop dismiss; search("") clears the query and cached results
          // so home navigation lands on a fresh search bar.
          onClick={(e) => {
            e.stopPropagation()
            void search("")
          }}
          className="pointer-events-auto mb-6 flex w-fit items-center rounded-full p-1 md:hidden focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
        >
          <Image
            src="/watch/images/jesusfilm-sign.svg"
            alt="JesusFilm"
            width={70}
            height={70}
            unoptimized
            className="h-auto max-w-[50px]"
          />
        </Link>
        <div
          onClick={(e) => e.stopPropagation()}
          className={`pointer-events-auto md:mx-0 md:max-w-[calc(100vw-11rem)] xl:mx-auto xl:max-w-[810px] ${SEARCH_OVERLAY_FIELD_WIDTH_CLASSES}`}
        >
          <div
            className={`flex flex-col gap-3 md:mx-0 md:max-w-[calc(100vw-11rem)] md:flex-row md:items-start md:gap-0 md:overflow-hidden md:rounded-[35px] md:bg-white md:shadow-xl md:outline-1 md:outline-white/15 xl:mx-auto xl:max-w-[810px] ${SEARCH_OVERLAY_FIELD_WIDTH_CLASSES}`}
          >
            <FloatingSearchFieldInput
              ref={inputRef}
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onClear={handleClearInput}
              placeholder={t("placeholder")}
              aria-label={t("inputLabel")}
              iconTestId="search-overlay-input-icon"
              wrapperClassName="w-full md:flex-1 md:rounded-r-none md:shadow-none md:outline-0"
            />
            {!algoliaSearchEnabled && searchLanguageControlVisible && (
              <div className="relative w-full md:w-72 md:shrink-0 lg:w-80">
                <LanguageCombobox
                  options={semanticLanguageComboboxOptions}
                  value={semanticLanguageComboboxValue}
                  onChange={handleSemanticLanguageSlugChange}
                  compact
                  open={languageAutocompleteOpen}
                  onOpenChange={setLanguageAutocompleteOpen}
                  disabled={languageOptionsLoading}
                  placeholder={t("searchLanguageLabel")}
                  popoverPortalContainer={closePortalContainer}
                  triggerClassName={semanticLanguageTriggerClassName}
                />
                {semanticLanguageOverrideActive && (
                  <button
                    type="button"
                    aria-label="Use website default search language"
                    onClick={handleResetSearchLanguage}
                    className="absolute right-1.5 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-950/5 hover:text-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950/30"
                  >
                    <X size={16} aria-hidden />
                  </button>
                )}
              </div>
            )}
          </div>
          {queryLanguageSuggestion && suggestedLanguageName && (
            <div className="mt-3 inline-flex max-w-full flex-wrap items-center gap-2 rounded-full bg-stone-950/70 px-3 py-2 text-sm text-stone-200 ring-1 ring-white/12 backdrop-blur-md">
              <span className="font-medium">
                {t("queryLanguageDetected", {
                  language: suggestedLanguageName,
                })}
              </span>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleQueryLanguageSuggestionConfirm}
                className="inline-flex h-8 cursor-pointer items-center rounded-full bg-brand-red px-3 text-xs font-semibold text-white transition hover:bg-brand-red/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
              >
                {t("searchInLanguage", { language: suggestedLanguageName })}
              </button>
            </div>
          )}
          {algoliaSearchEnabled && searchLanguageControlVisible && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t("searchLanguageLabel")}
                  aria-controls="search-language-panel"
                  aria-expanded={showLanguageBrowsePanel}
                  onClick={handleLanguagePanelToggle}
                  className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-white/12 px-4 text-sm font-medium text-stone-100 shadow-[0_8px_30px_rgba(0,0,0,0.22)] ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
                >
                  <Languages size={16} aria-hidden />
                  <span className="max-w-[12rem] truncate">
                    {selectedLanguageSummary}
                    {additionalLanguageCount > 0
                      ? ` +${additionalLanguageCount}`
                      : ""}
                  </span>
                  {showLanguageBrowsePanel ? (
                    <ChevronUp size={16} aria-hidden />
                  ) : (
                    <ChevronDown size={16} aria-hidden />
                  )}
                </button>
              </div>
              {selectedLanguageEnglishNames.map((language) => (
                <button
                  key={language}
                  type="button"
                  aria-label={`Remove ${language}`}
                  onClick={() => {
                    const option = languageGroups
                      .flatMap((group) => group.languages)
                      .find((item) => item.englishName === language)
                    toggleSearchLanguage(
                      option ?? {
                        englishName: language,
                        nativeName: null,
                        bcp47: null,
                        publicSlug: null,
                        regionNames: [],
                      },
                    )
                  }}
                  className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-full bg-white/10 px-3 text-xs font-medium text-stone-100 ring-1 ring-white/15 transition hover:bg-white/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
                >
                  <span className="max-w-[9rem] truncate">
                    {language.split(",")[0]}
                  </span>
                  <X size={13} aria-hidden />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <WatchModalViewportCloseButton
        open={open || closing}
        onClose={closeAndKeepQuery}
        testId="search-overlay-close"
        portalContainer={closePortalContainer}
        positionClassName="top-6 right-4 translate-y-2 md:top-12 md:right-10 md:translate-y-0"
      />

      <div
        aria-hidden="true"
        data-testid="search-overlay-bottom-backdrop"
        className="pointer-events-none absolute inset-x-0 bottom-[-14rem] z-0 h-[max(28rem,calc(env(safe-area-inset-bottom,0px)+24rem))] bg-black/85 backdrop-blur-[14px]"
      />

      {/* Body: category grid when empty, results grid when queried. Its top
          edge clears the floating search controls so cards cannot scroll under
          the language chip or detected-language prompt. */}
      <div
        className={`search-overlay-scroll absolute inset-x-0 bottom-0 z-1 overflow-y-auto px-4 pb-8 sm:px-6 ${searchOverlayScrollTopClass}`}
        aria-live="polite"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="mx-auto max-w-[1400px]"
        >
          {showLanguageBrowsePanel && (
            <div
              id="search-language-panel"
              className="relative z-30 mb-6 overflow-visible border-y border-white/12 bg-stone-950/55 px-4 py-5 text-stone-100 shadow-2xl shadow-black/20 backdrop-blur-xl sm:px-6"
            >
              {algoliaSearchEnabled ? (
                <div
                  role="tablist"
                  aria-label="Search browse mode"
                  className="grid grid-cols-2 gap-0 border-b border-white/12 md:flex md:items-end md:justify-start md:gap-10"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={algoliaBrowseTab === "suggestions"}
                    onClick={() => setAlgoliaBrowseTab("suggestions")}
                    className={`flex min-h-14 min-w-0 cursor-pointer items-center justify-center gap-3 border-b-3 px-2 text-xs font-bold tracking-[0.22em] uppercase transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 sm:text-sm md:min-w-72 ${
                      algoliaBrowseTab === "suggestions"
                        ? "border-brand-red text-stone-100"
                        : "border-transparent text-stone-500 hover:text-stone-300"
                    }`}
                  >
                    <SearchIcon className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
                    <span className="truncate">{t("searchSuggestions")}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={algoliaBrowseTab === "languages"}
                    onClick={() => setAlgoliaBrowseTab("languages")}
                    className={`flex min-h-14 min-w-0 cursor-pointer items-center justify-center gap-3 border-b-3 px-2 text-xs font-bold tracking-[0.22em] uppercase transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 sm:text-sm md:min-w-72 ${
                      algoliaBrowseTab === "languages"
                        ? "border-brand-red text-stone-100"
                        : "border-transparent text-stone-500 hover:text-stone-300"
                    }`}
                  >
                    <Globe2 className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
                    <span className="truncate">{t("languages")}</span>
                    <span className="rounded-full border border-white/18 px-2 py-0.5 text-[0.7rem] tracking-[0.16em] text-stone-300 sm:text-xs">
                      {languageCountLabel}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="border-b border-white/12 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
                        {t("searchLanguageLabel")}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/18 px-2 py-0.5 text-[0.7rem] font-semibold tracking-[0.16em] text-stone-300 uppercase sm:text-xs">
                      {languageCountLabel}
                    </span>
                  </div>
                  <div className="mt-4 max-w-md">
                    <LanguageCombobox
                      options={semanticLanguageComboboxOptions}
                      value={semanticLanguageComboboxValue}
                      onChange={handleSemanticLanguageSlugChange}
                      compact
                      open={languageAutocompleteOpen}
                      onOpenChange={setLanguageAutocompleteOpen}
                      placeholder={t("searchLanguageLabel")}
                      popoverPortalContainer={closePortalContainer}
                    />
                  </div>
                </div>
              )}

              {algoliaSearchEnabled && algoliaBrowseTab === "suggestions" && (
                <div className="pt-6">
                  {recommendedLanguage && (
                    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-stone-300">
                      <span className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
                        {t("recommendedLanguage")}
                      </span>
                      <button
                        type="button"
                        onClick={handleRecommendedLanguageClick}
                        className="inline-flex h-8 cursor-pointer items-center rounded-full bg-brand-red px-3 text-xs font-semibold text-white transition hover:bg-brand-red/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
                      >
                        {recommendedLanguage.englishName}
                      </button>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {ALGOLIA_SEARCH_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        aria-label={
                          recommendedLanguageName
                            ? t("searchSuggestionWithLanguage", {
                                suggestion,
                                language: recommendedLanguageName,
                              })
                            : t("searchSuggestion", { suggestion })
                        }
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-md border border-white/12 bg-white/8 px-4 py-3 text-left text-sm font-semibold text-stone-200 transition hover:border-white/24 hover:bg-white/14 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
                      >
                        <span className="truncate">{suggestion}</span>
                        {recommendedLanguageName && (
                          <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[0.68rem] font-bold tracking-[0.12em] text-stone-300 uppercase">
                            {t("inLanguage", {
                              language: recommendedLanguageName,
                            })}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!algoliaSearchEnabled && (
                <div className="pt-5">
                  {languageOptionsLoading && (
                    <p className="text-sm text-stone-400">{t("loading")}</p>
                  )}
                  {languageOptionsError && !languageOptionsLoading && (
                    <p className="text-sm text-brand-red">
                      {languageOptionsError}
                    </p>
                  )}
                </div>
              )}

              {algoliaSearchEnabled && algoliaBrowseTab === "languages" && (
                <div className="pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
                        {t("browseByRegion")}
                      </p>
                    </div>
                    {selectedLanguageEnglishNames.length > 0 && (
                      <button
                        type="button"
                        onClick={clearSearchLanguages}
                        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full bg-white/10 px-3 text-xs font-medium text-stone-200 transition hover:bg-white/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
                      >
                        <X size={13} aria-hidden />
                        {t("clearLanguages")}
                      </button>
                    )}
                  </div>

                  {languageCountrySuggestion && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                      <div className="mr-2 flex items-center gap-2 text-xs font-semibold text-stone-300">
                        {languageCountrySuggestion.flagPngSrc && (
                          <Image
                            src={languageCountrySuggestion.flagPngSrc}
                            alt=""
                            width={25}
                            height={15}
                            className="rounded-[2px]"
                            unoptimized
                          />
                        )}
                        <span>{languageCountrySuggestion.countryName}:</span>
                      </div>
                      {languageCountrySuggestion.languages.map((language) => {
                        const selected = selectedLanguageEnglishNames.includes(
                          language.englishName,
                        )
                        const disabled = !selected && languageSelectionAtLimit
                        return (
                          <button
                            key={`country-${language.englishName}`}
                            type="button"
                            disabled={disabled}
                            aria-pressed={selected}
                            onClick={() => toggleSearchLanguage(language)}
                            className={`h-8 cursor-pointer rounded-full px-3 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 disabled:cursor-not-allowed disabled:opacity-40 ${
                              selected
                                ? "bg-brand-red text-white"
                                : "bg-white/10 text-stone-200 hover:bg-white/16"
                            }`}
                          >
                            {language.englishName.split(",")[0]}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {languageOptionsLoading && (
                    <p className="mt-4 text-sm text-stone-400">
                      {t("loading")}
                    </p>
                  )}
                  {languageOptionsError && !languageOptionsLoading && (
                    <p className="mt-4 text-sm text-brand-red">
                      {languageOptionsError}
                    </p>
                  )}

                  {!languageOptionsLoading &&
                    orderedLanguageGroups.length > 0 && (
                      <>
                        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-6">
                          {orderedLanguageGroups.map((group) => {
                            const selected =
                              group.regionName === activeRegionGroup?.regionName
                            return (
                              <button
                                key={group.regionName}
                                type="button"
                                aria-pressed={selected}
                                onClick={() =>
                                  setSelectedRegionName(group.regionName)
                                }
                                className={`min-h-10 cursor-pointer rounded-md px-1 text-left text-base font-semibold text-brand-red transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 sm:text-lg ${
                                  selected
                                    ? "bg-brand-red/10 text-brand-red"
                                    : "hover:bg-white/8"
                                }`}
                              >
                                <span className="block truncate">
                                  {group.regionName}
                                </span>
                              </button>
                            )
                          })}
                        </div>

                        {activeRegionGroup && (
                          <div className="mt-5 max-h-[min(44vh,30rem)] overflow-y-auto pr-1">
                            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                              {activeRegionGroup.languages.map((language) => {
                                const selected =
                                  selectedLanguageEnglishNames.includes(
                                    language.englishName,
                                  )
                                const selectedRegion =
                                  selectedLanguageRegionByName[
                                    language.englishName
                                  ]
                                const disabled =
                                  (!selected && languageSelectionAtLimit) ||
                                  (selected &&
                                    selectedRegion != null &&
                                    selectedRegion !==
                                      activeRegionGroup.regionName)
                                return (
                                  <button
                                    key={`${activeRegionGroup.regionName}-${language.englishName}`}
                                    type="button"
                                    disabled={disabled}
                                    aria-pressed={selected && !disabled}
                                    onClick={() =>
                                      toggleSearchLanguage(
                                        language,
                                        activeRegionGroup.regionName,
                                      )
                                    }
                                    className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 disabled:cursor-not-allowed disabled:opacity-40 ${
                                      selected && !disabled
                                        ? "bg-brand-red text-white"
                                        : "text-stone-200 hover:bg-white/10"
                                    }`}
                                  >
                                    <span className="truncate">
                                      {language.englishName}
                                    </span>
                                    {language.facetCount != null && (
                                      <span className="shrink-0 text-xs text-stone-400">
                                        {language.facetCount}
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                </div>
              )}
            </div>
          )}

          {showCategoryGrid && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICON_BY_SEARCH_TERM[cat.searchTerm]
                const title = t(CATEGORY_TITLE_KEYS[cat.searchTerm])
                return (
                  <button
                    key={cat.searchTerm}
                    type="button"
                    onClick={() => handleCategoryClick(cat.searchTerm)}
                    aria-label={title}
                    data-testid={`search-overlay-category-${cat.searchTerm.replace(/\s+/g, "-")}`}
                    className="group relative isolate aspect-video w-full cursor-pointer overflow-hidden rounded-lg p-3 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 sm:p-6"
                  >
                    <span
                      aria-hidden="true"
                      data-testid={`search-overlay-category-background-${cat.searchTerm.replace(/\s+/g, "-")}`}
                      className="search-card-hover-zoom pointer-events-none absolute inset-0 z-0 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{ background: cat.gradient }}
                    >
                      {Icon ? (
                        <Icon
                          aria-hidden="true"
                          className="absolute right-1 top-1 h-16 w-16 opacity-30 drop-shadow-lg sm:right-2 sm:top-2 sm:h-24 sm:w-24"
                        />
                      ) : null}
                    </span>
                    <span
                      aria-hidden="true"
                      data-testid={`search-overlay-category-hover-outline-${cat.searchTerm.replace(/\s+/g, "-")}`}
                      className="search-card-hover-outline search-card-red-outline pointer-events-none absolute z-20 opacity-0 transition-opacity duration-200"
                    />
                    <span
                      className="absolute bottom-3 left-3 z-10 text-base font-semibold leading-tight sm:text-lg md:text-xl"
                      style={{ textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
                    >
                      {title}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {loading && showSkeleton && (
            <div
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              aria-hidden="true"
            >
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="overflow-hidden rounded-2xl bg-white/5">
                  <div className="aspect-video w-full animate-pulse bg-white/10" />
                  <div className="flex flex-col gap-2 p-3">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                    <div className="h-3 w-full animate-pulse rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {loading && !showSkeleton && (
            <p className="sr-only">{t("searching")}</p>
          )}

          {!loading && searched && displayResults.length === 0 && error && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h2 className="text-lg font-semibold text-stone-200">{error}</h2>
              <p className="mt-2 text-sm text-stone-500">
                {t("connectionHint")}
              </p>
              <button
                type="button"
                onClick={() => void search(query)}
                className="mt-4 cursor-pointer rounded-lg bg-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:bg-stone-600 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
              >
                {t("retrySearch")}
              </button>
            </div>
          )}

          {!loading && searched && displayResults.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h2 className="text-lg font-semibold text-stone-200">
                {t("noResults", { query: query.trim() })}
              </h2>
              <p className="mt-2 text-sm text-stone-500">
                {semanticSearchEnabled
                  ? t("tryDifferentKeywordsOrLanguage")
                  : t("tryDifferentKeywords")}
              </p>
              {queryLanguageSuggestion && suggestedLanguageName && (
                <button
                  type="button"
                  onClick={handleQueryLanguageSuggestionConfirm}
                  className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-full bg-brand-red px-4 text-sm font-semibold text-white transition hover:bg-brand-red/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
                >
                  {t("searchInLanguage", { language: suggestedLanguageName })}
                </button>
              )}
            </div>
          )}

          {displayResults.length > 0 && (
            <>
              <div
                key={resultsKey}
                className={`grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4${exiting ? " animate-card-exit" : ""}`}
              >
                {displayResults.map((result, index) => (
                  <div
                    key={`${result.id}-${index}`}
                    onClick={() => closeAndKeepQuery()}
                  >
                    <VideoCard
                      result={result}
                      index={exiting ? 0 : index}
                      onResultClick={
                        searchResultAnalytics
                          ? (clickedResult) => {
                              reportDatadogRumAction(
                                WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION,
                                buildWatchSearchResultClickRumContext(
                                  clickedResult,
                                  {
                                    ...searchResultAnalytics,
                                    position: index + 1,
                                  },
                                ),
                              )
                            }
                          : undefined
                      }
                    />
                  </div>
                ))}
              </div>

              {error && (
                <div className="mt-6 text-center">
                  <p className="text-sm text-brand-red">{error}</p>
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="mt-2 cursor-pointer rounded-lg bg-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:bg-stone-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("retry")}
                  </button>
                </div>
              )}

              {hasMore && !error && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/10 px-6 py-3 text-sm font-medium text-stone-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
                  >
                    {loadingMore && (
                      <SpinnerIcon className="h-4 w-4 animate-spin" />
                    )}
                    {loadingMore ? t("loading") : t("loadMore")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
