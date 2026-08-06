"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"

import {
  useFloatingSearch,
  useWatchRouteSurface,
} from "./FloatingSearchContext"
import {
  FloatingSearchFieldInput,
  useFloatingSearchInputAutofocus,
} from "./FloatingSearchField"
import { CATEGORY_ICON_BY_SEARCH_TERM } from "./SearchCategoryIcons"
import { VideoCard } from "./search/VideoCard"
import { reportDatadogRumAction } from "@/components/DatadogRum"
import { SpinnerIcon } from "@/components/ui/spinner"
import {
  recordWatchSearchResultClick,
  recordWatchSearchResultsViewed,
} from "@/lib/search-actions"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import { CATEGORIES } from "@/lib/search-categories"
import {
  FLOATING_HEADER_FIELD_WIDTH_CLASS,
  FLOATING_HEADER_HOME_LOGO_SLOT_CLASS,
  FLOATING_HEADER_LANGUAGE_SLOT_CLASS,
  FLOATING_HEADER_LOGO_SLOT_CLASS,
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
import type { CategorySearchTerm } from "@/lib/search-categories"
import type { SearchLanguageOption } from "@/lib/search-language"
import { parseWatchPath } from "@/lib/routes"
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

export function SearchOverlay() {
  const t = useTranslations("SearchOverlay")
  const pathname = usePathname()
  const parsedPath = parseWatchPath(pathname)
  const routeSurface = useWatchRouteSurface()
  const isWatchHome =
    routeSurface == null
      ? parsedPath.kind === "home" || parsedPath.kind === "localized-home"
      : routeSurface === "language-home" || routeSurface === "experience"
  const logoSlotClass = isWatchHome
    ? FLOATING_HEADER_HOME_LOGO_SLOT_CLASS
    : FLOATING_HEADER_LOGO_SLOT_CLASS
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
    languageOptions,
    languageOptionsLoading,
    languageOptionsError,
    selectedSearchLanguageOption,
    searchResultAnalytics,
    headerLanguageSwitcherVisible,
    headerLanguageCode,
    headerPinned,
    setOpen,
    setQuery,
    search,
    loadMore,
    selectSearchLanguage,
    resetSearchLanguageToDefault,
  } = useFloatingSearch()

  const overlayRef = useRef<HTMLDivElement>(null)
  const [closePortalContainer, setClosePortalContainer] =
    useState<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recordedResultClickKeysRef = useRef<Set<string>>(new Set())
  const recordedResultsViewedKeysRef = useRef<Map<string, Set<string>>>(
    new Map(),
  )
  const [languageAutocompleteOpen, setLanguageAutocompleteOpen] =
    useState(false)

  const setOverlayElement = useCallback((node: HTMLDivElement | null) => {
    overlayRef.current = node
    setClosePortalContainer(node)
  }, [])

  useFloatingSearchInputAutofocus(open, inputRef)

  // Escape closes the modal through the provider-owned reset boundary.
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, setOpen])

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
      const overlayFocusable = Array.from(
        overlay.querySelectorAll<HTMLElement>(
          'input, button, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      const headerLogo = document.querySelector<HTMLElement>(
        '[data-testid="floating-header-logo"]',
      )
      const headerLanguage = document.querySelector<HTMLElement>(
        '[data-testid="floating-header-language-button"]',
      )
      const headerClose = document.querySelector<HTMLElement>(
        '[data-testid="floating-header-search-close"]',
      )
      const focusable = [
        headerLogo,
        ...overlayFocusable,
        headerLanguage,
        headerClose,
      ].filter((element): element is HTMLElement => element != null)
      if (focusable.length === 0) return
      const activeIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      )
      const nextIndex = e.shiftKey
        ? activeIndex <= 0
          ? focusable.length - 1
          : activeIndex - 1
        : activeIndex === -1 || activeIndex >= focusable.length - 1
          ? 0
          : activeIndex + 1
      e.preventDefault()
      focusable[nextIndex]?.focus()
    }
    document.addEventListener("keydown", handleTab)
    return () => document.removeEventListener("keydown", handleTab)
  }, [open])

  const visibleResultIds = useMemo(
    () => displayResults.map((row) => row.id),
    [displayResults],
  )

  useEffect(() => {
    if (!searchResultAnalytics || visibleResultIds.length === 0) return
    const requestId = searchResultAnalytics.searchRequestId
    const recordedIds =
      recordedResultsViewedKeysRef.current.get(requestId) ?? new Set<string>()
    const newlyVisibleResultIds = visibleResultIds.filter(
      (id) => !recordedIds.has(id),
    )
    if (newlyVisibleResultIds.length === 0) return
    for (const id of newlyVisibleResultIds) {
      recordedIds.add(id)
    }
    recordedResultsViewedKeysRef.current.set(requestId, recordedIds)
    void recordWatchSearchResultsViewed({
      requestId,
      visibleResultIds: newlyVisibleResultIds,
      routeLanguageSlug: searchResultAnalytics.routeLanguageSlug,
      searchLanguageSlug: searchResultAnalytics.searchLanguageSlug,
    })
  }, [searchResultAnalytics, visibleResultIds])

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value)
    },
    [setQuery],
  )

  const handleSearchSubmit = useCallback(
    (submittedQuery: string) => {
      void search(submittedQuery)
    },
    [search],
  )

  const handleCategoryClick = useCallback(
    (searchTerm: string) => {
      void search(searchTerm)
    },
    [search],
  )

  const handleSemanticLanguageClick = useCallback(
    (language: SearchLanguageOption, regionName?: string) => {
      if (!language.publicSlug) return
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
    setLanguageAutocompleteOpen(false)
    resetSearchLanguageToDefault()
  }, [resetSearchLanguageToDefault])

  const closeAfterResultNavigation = useCallback(() => {
    window.setTimeout(() => setOpen(false), 0)
  }, [setOpen])

  const handleClearInput = useCallback(() => {
    void search("")
    inputRef.current?.focus()
  }, [search])

  const showCategoryGrid = query.trim().length === 0 && !loading && !searched
  const searchLanguageControlVisible =
    languageOptionsLoading ||
    languageOptions.length > 0 ||
    languageOptionsError != null
  const searchOverlayScrollTopClass = searchLanguageControlVisible
    ? "top-60 md:top-48"
    : "top-44 md:top-32"
  const semanticLanguageOverrideActive =
    selectedSearchLanguageOption?.publicSlug != null
  const semanticLanguageTriggerClassName = [
    "!h-[52px] !min-h-[52px] !rounded-[35px] !border-0 !bg-white !text-stone-950 shadow-xl hover:!bg-stone-50 focus-visible:ring-stone-950/20",
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
    selectedSearchLanguageOption?.publicSlug ?? ""

  const handleSemanticLanguageSlugChange = useCallback(
    (slug: string) => {
      const language = semanticLanguageOptionBySlug.get(slug)
      if (!language) return
      handleSemanticLanguageClick(language, language.regionNames[0])
    },
    [handleSemanticLanguageClick, semanticLanguageOptionBySlug],
  )
  const headerTopClass = headerPinned
    ? FLOATING_HEADER_PINNED_TOP_CLASS
    : FLOATING_HEADER_TOP_CLASS

  return (
    <div
      ref={setOverlayElement}
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
      className={`fixed inset-0 h-dvh min-h-dvh overflow-visible ${closing ? "animate-overlay-fade-out" : "animate-overlay-fade-in"}`}
      style={{
        zIndex: 45,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Mirror the floating header grid so the active input lands exactly
          where its hidden header slot sits. On mobile, logo/close occupy the
          first row and search/language occupy the second. The persistent
          header stays above this overlay and owns all three controls. */}
      <div
        data-testid="search-overlay-top-bar"
        className={`pointer-events-none absolute ${WATCH_PAGE_LEFT_EDGE_CLASSES} ${WATCH_PAGE_RIGHT_EDGE_CLASSES} ${headerTopClass} z-10 ${FLOATING_MODAL_HEADER_LAYOUT_CLASS}`}
      >
        <div
          aria-hidden="true"
          className={`${logoSlotClass} ${FLOATING_MODAL_HEADER_LOGO_POSITION_CLASS}`}
        />
        <div
          data-testid="search-overlay-field-shell"
          onClick={(e) => e.stopPropagation()}
          className={`pointer-events-auto ${FLOATING_HEADER_FIELD_WIDTH_CLASS} ${FLOATING_MODAL_HEADER_FIELD_POSITION_CLASS} ${
            headerLanguageSwitcherVisible ? "" : "col-span-2"
          }`}
        >
          <FloatingSearchFieldInput
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onSubmit={handleSearchSubmit}
            onClear={handleClearInput}
            placeholder={t("placeholder")}
            aria-label={t("inputLabel")}
            iconTestId="search-overlay-input-icon"
            autoFocus
            wrapperClassName="w-full"
          />
          {searchLanguageControlVisible && (
            <div className="relative mt-3 w-full md:w-72 lg:w-80">
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
                  aria-label={t("useWebsiteDefaultLanguage")}
                  onClick={handleResetSearchLanguage}
                  className="absolute right-1.5 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-950/5 hover:text-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950/30"
                >
                  <X size={16} aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
        <div
          aria-hidden="true"
          data-testid="search-overlay-trailing-controls-spacer"
          className={FLOATING_MODAL_HEADER_TRAILING_GROUP_CLASS}
        >
          {headerLanguageSwitcherVisible ? (
            <div
              className={`${FLOATING_HEADER_LANGUAGE_SLOT_CLASS} ${FLOATING_MODAL_HEADER_LANGUAGE_POSITION_CLASS} ${
                headerLanguageCode
                  ? "w-auto min-w-[4.25rem] px-2 md:w-auto md:min-w-[4.75rem]"
                  : ""
              }`}
            />
          ) : null}
          <div
            className={`${FLOATING_HEADER_TRAILING_SLOT_CLASS} ${FLOATING_MODAL_HEADER_CLOSE_POSITION_CLASS}`}
          />
        </div>
      </div>

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
                      className="search-category-hover-outline search-category-red-outline pointer-events-none absolute z-20 opacity-0 transition-opacity duration-200"
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
                {t("tryDifferentKeywordsOrLanguage")}
              </p>
            </div>
          )}

          {displayResults.length > 0 && (
            <>
              <div
                key={resultsKey}
                className={`grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4${exiting ? " animate-card-exit" : ""}`}
              >
                {displayResults.map((result, index) => (
                  <VideoCard
                    key={`${result.id}-${index}`}
                    result={result}
                    index={exiting ? 0 : index}
                    onResultClick={
                      searchResultAnalytics
                        ? (clickedResult) => {
                            closeAfterResultNavigation()
                            const clickKey = [
                              searchResultAnalytics.searchRequestId,
                              clickedResult.id,
                              index + 1,
                            ].join(":")
                            if (
                              recordedResultClickKeysRef.current.has(clickKey)
                            ) {
                              return
                            }
                            recordedResultClickKeysRef.current.add(clickKey)
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
                            void recordWatchSearchResultClick({
                              requestId: searchResultAnalytics.searchRequestId,
                              resultId: clickedResult.id,
                              resultType: clickedResult.type,
                              position: index + 1,
                              visibleResultIds,
                              routeLanguageSlug:
                                searchResultAnalytics.routeLanguageSlug,
                              searchLanguageSlug:
                                searchResultAnalytics.searchLanguageSlug,
                            })
                          }
                        : () => {
                            closeAfterResultNavigation()
                          }
                    }
                  />
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
