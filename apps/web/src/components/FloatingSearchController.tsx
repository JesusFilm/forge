"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"

import { runSearch } from "@/lib/search-actions"
import { getSearchLanguageOptions } from "@/lib/search-language-actions"
import type { SearchActionResultSource, SearchResult } from "@/lib/search"
import {
  MAX_SEARCH_LANGUAGE_FILTERS,
  findSearchLanguageOptionByPublicSlug,
  groupSearchLanguagesByRegion,
  normalizeSearchLanguageEnglishNames,
  stripLanguageFromSearchQuery,
  type SearchLanguageCountrySuggestion,
  type SearchLanguageOption,
} from "@/lib/search-language"
import { buildSearchUrl } from "@/lib/search-url"
import { parseWatchPath } from "@/lib/routes"
import {
  FloatingSearchContext,
  type FloatingSearchContextValue,
} from "./FloatingSearchContext"

import { SearchOverlay } from "./SearchOverlay"

const SEARCH_PAGE_SIZE = 10
const SEARCH_LANGUAGE_OPTIONS_FALLBACK_MS = 1200

type ActiveSearchSignature = {
  query: string
  languageEnglishNames: string[]
  languageSlug: string | null
  languageKey: string
  routeLanguageSlug: string | null
  resultSource: SearchActionResultSource
  nextOffset: number
}

function buildCurrentSearchUrl(
  pathname: string,
  currentParams: URLSearchParams,
): string {
  const serializedParams = currentParams.toString()
  return serializedParams.length > 0
    ? `${pathname}?${serializedParams}`
    : pathname
}

export type FloatingSearchControllerProps = {
  open: boolean
  closing: boolean
  query: string
  setOpen: (open: boolean) => void
  setQuery: (query: string) => void
  resetToken?: number
  children?: ReactNode
}

export function FloatingSearchController({
  open,
  closing,
  query,
  setOpen,
  setQuery: setQueryState,
  resetToken = 0,
  children,
}: FloatingSearchControllerProps) {
  const tSearchOverlay = useTranslations("SearchOverlay")
  // usePathname() does NOT force the Full Route Cache deopt that
  // useSearchParams() would. Keep it for route-language parsing, but use the
  // browser pathname when mutating the visible ?q= URL below so deployments
  // with a basePath keep their public path intact.
  const pathname = usePathname()

  // Whether the modal was opened via URL hydration (vs user click). Gates a
  // shorter skeleton threshold so the URL-hydrated blank window is less jarring.
  const hydratedOpenRef = useRef<boolean>(false)

  const [results, setResults] = useState<SearchResult[]>([])
  const [displayResults, setDisplayResults] = useState<SearchResult[]>([])
  const [exiting, setExiting] = useState(false)
  const [resultsKey, setResultsKey] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [resultSource, setResultSource] =
    useState<SearchActionResultSource | null>(null)
  const [algoliaSearchEnabled, setAlgoliaSearchEnabled] = useState(false)
  const [languageOptions, setLanguageOptions] = useState<
    SearchLanguageOption[]
  >([])
  const [languageCountrySuggestion, setLanguageCountrySuggestion] =
    useState<SearchLanguageCountrySuggestion | null>(null)
  const [recommendedLanguage, setRecommendedLanguage] =
    useState<SearchLanguageOption | null>(null)
  const [languageOptionsLoaded, setLanguageOptionsLoaded] = useState(false)
  const [languageOptionsLoading, setLanguageOptionsLoading] = useState(false)
  const [languageOptionsError, setLanguageOptionsError] = useState<
    string | null
  >(null)
  const [languageFacets, setLanguageFacets] = useState<Record<string, number>>(
    {},
  )
  const [selectedLanguageEnglishNames, setSelectedLanguageEnglishNames] =
    useState<string[]>([])
  const [selectedLanguageRegionByName, setSelectedLanguageRegionByName] =
    useState<Record<string, string>>({})
  const [selectedSearchLanguageOption, setSelectedSearchLanguageOption] =
    useState<SearchLanguageOption | null>(null)

  const requestIdRef = useRef(0)
  const languageOptionsRequestIdRef = useRef(0)
  const languageOptionsLoadedRef = useRef(false)
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingMoreRef = useRef(false)
  const loadMoreRunIdRef = useRef(0)
  const displayResultsRef = useRef<SearchResult[]>([])
  const languageOptionsRef = useRef<SearchLanguageOption[]>([])
  const queryRef = useRef("")
  const selectedLanguageEnglishNamesRef = useRef<string[]>([])
  const selectedSearchLanguageOptionRef = useRef<SearchLanguageOption | null>(
    null,
  )
  const searchLanguageSelectionUserSetRef = useRef(false)
  const activeSearchSignatureRef = useRef<ActiveSearchSignature | null>(null)
  useEffect(() => {
    displayResultsRef.current = displayResults
  }, [displayResults])
  useEffect(() => {
    languageOptionsRef.current = languageOptions
  }, [languageOptions])
  useEffect(() => {
    selectedLanguageEnglishNamesRef.current = selectedLanguageEnglishNames
  }, [selectedLanguageEnglishNames])
  useEffect(() => {
    selectedSearchLanguageOptionRef.current = selectedSearchLanguageOption
  }, [selectedSearchLanguageOption])

  const setQuery = useCallback(
    (nextQuery: string) => {
      queryRef.current = nextQuery
      setQueryState(nextQuery)
    },
    [setQueryState],
  )

  // Cancel any pending skeleton timer on unmount.
  useEffect(() => {
    return () => {
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
    }
  }, [])

  const [portalReady, setPortalReady] = useState(false)
  useEffect(() => {
    setPortalReady(true)
  }, [])

  const languageGroups = useMemo(
    () => groupSearchLanguagesByRegion(languageOptions),
    [languageOptions],
  )
  const routeLanguageSlug = useMemo(() => {
    const parsed = parseWatchPath(pathname)
    if (
      parsed.kind === "localized-home" ||
      parsed.kind === "video" ||
      parsed.kind === "episode"
    ) {
      return parsed.lang
    }
    return null
  }, [pathname])
  const defaultSearchLanguage = useMemo(
    () =>
      defaultSearchLanguageOption({
        options: languageOptions,
        routeLanguageSlug,
        recommendedLanguage,
      }),
    [languageOptions, recommendedLanguage, routeLanguageSlug],
  )

  const refreshLanguageOptions = useCallback(
    async (
      availableLanguageFacets?: Record<string, number>,
    ): Promise<SearchLanguageOption[]> => {
      const thisRequest = ++languageOptionsRequestIdRef.current
      languageOptionsLoadedRef.current = false
      setLanguageOptionsLoaded(false)
      setLanguageOptionsLoading(true)
      setLanguageOptionsError(null)

      try {
        const response = await getSearchLanguageOptions({
          availableLanguageFacets,
        })
        if (languageOptionsRequestIdRef.current !== thisRequest) {
          return response.ok ? response.options : []
        }
        setAlgoliaSearchEnabled(response.algoliaEnabled)

        if (response.ok) {
          setLanguageOptions(response.options)
          setLanguageCountrySuggestion(response.countrySuggestion)
          setRecommendedLanguage(response.recommendedLanguage)
          if (!searchLanguageSelectionUserSetRef.current) {
            const defaultOption = defaultSearchLanguageOption({
              options: response.options,
              routeLanguageSlug,
              recommendedLanguage: response.recommendedLanguage,
            })
            const nextLanguages = defaultOption
              ? [defaultOption.englishName]
              : []
            selectedSearchLanguageOptionRef.current = defaultOption
            selectedLanguageEnglishNamesRef.current = nextLanguages
            setSelectedSearchLanguageOption(defaultOption)
            setSelectedLanguageEnglishNames(nextLanguages)
            setSelectedLanguageRegionByName(
              defaultOption?.regionNames[0]
                ? { [defaultOption.englishName]: defaultOption.regionNames[0] }
                : {},
            )
          }
          return response.options
        }

        setLanguageOptions([])
        setLanguageCountrySuggestion(null)
        setRecommendedLanguage(null)
        if (!searchLanguageSelectionUserSetRef.current) {
          selectedSearchLanguageOptionRef.current = null
          selectedLanguageEnglishNamesRef.current = []
          setSelectedSearchLanguageOption(null)
          setSelectedLanguageEnglishNames([])
          setSelectedLanguageRegionByName({})
        }
        setLanguageOptionsError(response.error.message)
        return []
      } catch {
        if (languageOptionsRequestIdRef.current !== thisRequest) return []
        setLanguageOptions([])
        setLanguageCountrySuggestion(null)
        setRecommendedLanguage(null)
        if (!searchLanguageSelectionUserSetRef.current) {
          selectedSearchLanguageOptionRef.current = null
          selectedLanguageEnglishNamesRef.current = []
          setSelectedSearchLanguageOption(null)
          setSelectedLanguageEnglishNames([])
          setSelectedLanguageRegionByName({})
        }
        setLanguageOptionsError("Language options are unavailable.")
        return []
      } finally {
        if (languageOptionsRequestIdRef.current === thisRequest) {
          languageOptionsLoadedRef.current = true
          setLanguageOptionsLoaded(true)
          setLanguageOptionsLoading(false)
        }
      }
    },
    [routeLanguageSlug],
  )

  useEffect(() => {
    if (searchLanguageSelectionUserSetRef.current) return
    selectedSearchLanguageOptionRef.current = defaultSearchLanguage
    setSelectedSearchLanguageOption(defaultSearchLanguage)
    const nextLanguages = defaultSearchLanguage
      ? [defaultSearchLanguage.englishName]
      : []
    selectedLanguageEnglishNamesRef.current = nextLanguages
    setSelectedLanguageEnglishNames(nextLanguages)
    setSelectedLanguageRegionByName(
      defaultSearchLanguage?.regionNames[0]
        ? {
            [defaultSearchLanguage.englishName]:
              defaultSearchLanguage.regionNames[0],
          }
        : {},
    )
  }, [defaultSearchLanguage])

  useEffect(() => {
    if (!open) return
    void refreshLanguageOptions(
      Object.keys(languageFacets).length > 0 ? languageFacets : undefined,
    )
  }, [open, languageFacets, refreshLanguageOptions])

  const maybeSetLanguageFacets = useCallback(
    (
      nextLanguageFacets: Record<string, number>,
      activeLanguageEnglishNames: readonly string[],
    ): void => {
      if (activeLanguageEnglishNames.length > 0) return
      setLanguageFacets(nextLanguageFacets)
    },
    [],
  )

  const clearLoadingForRequest = useCallback((requestId: number): void => {
    if (requestIdRef.current !== requestId) return
    if (skeletonTimerRef.current) {
      clearTimeout(skeletonTimerRef.current)
      skeletonTimerRef.current = null
    }
    setShowSkeleton(false)
    setLoading(false)
  }, [])

  const search = useCallback(
    async (
      q: string,
      options?: {
        languageEnglishNames?: string[]
        languageSlug?: string | null
      },
    ): Promise<void> => {
      const trimmed = q.trim()
      setQuery(q)

      // Bump the request id immediately so any in-flight request (from a prior
      // call in any branch — exit-animation, Apollo, or clear) fails its
      // freshness check when it resolves.
      const thisRequest = ++requestIdRef.current
      loadMoreRunIdRef.current += 1
      loadingMoreRef.current = false
      activeSearchSignatureRef.current = null
      setLoadingMore(false)

      const currentParams =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams()
      const browserPathname =
        typeof window !== "undefined" ? window.location.pathname : pathname
      const nextUrl = buildSearchUrl(browserPathname, currentParams, trimmed)
      if (nextUrl !== buildCurrentSearchUrl(browserPathname, currentParams)) {
        // The search modal owns ?q= as client-side UI state. Using
        // router.replace() here dispatches an App Router/RSC navigation, which
        // can remount the overlay and clear a newer debounced search while the
        // viewer is still typing.
        try {
          window.history.replaceState(window.history.state, "", nextUrl)
        } catch (error) {
          console.warn("[FloatingSearch] failed to sync search URL", error)
        }
      }

      if (!trimmed) {
        if (displayResultsRef.current.length > 0) {
          setExiting(true)
          await new Promise<void>((resolve) => setTimeout(resolve, 200))
          if (requestIdRef.current !== thisRequest) return
          setExiting(false)
        }
        if (requestIdRef.current !== thisRequest) return
        setResults([])
        setDisplayResults([])
        setHasMore(false)
        setSearched(false)
        setError(null)
        setResultSource(null)
        activeSearchSignatureRef.current = null
        clearLoadingForRequest(thisRequest)
        return
      }

      if (displayResultsRef.current.length > 0) {
        setExiting(true)
        await new Promise<void>((resolve) => setTimeout(resolve, 200))
        if (requestIdRef.current !== thisRequest) return
        setExiting(false)
        setDisplayResults([])
      }

      setLoading(true)
      setError(null)
      setSearched(true)
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
      const skeletonThreshold = hydratedOpenRef.current ? 150 : 500
      skeletonTimerRef.current = setTimeout(() => {
        if (requestIdRef.current === thisRequest) setShowSkeleton(true)
      }, skeletonThreshold)

      try {
        const currentLanguageOptions = languageOptionsLoadedRef.current
          ? languageOptionsRef.current
          : await withSearchLanguageOptionsFallback(
              refreshLanguageOptions(
                Object.keys(languageFacets).length > 0
                  ? languageFacets
                  : undefined,
              ),
              () => languageOptionsRef.current,
            )
        if (requestIdRef.current !== thisRequest) return
        const activeLanguageEnglishNames =
          options?.languageEnglishNames ??
          selectedLanguageEnglishNamesRef.current
        const defaultLanguageSlug = algoliaSearchEnabled
          ? null
          : (selectedSearchLanguageOptionRef.current?.publicSlug ?? null)
        const activeLanguageSlug =
          options?.languageSlug !== undefined
            ? options.languageSlug
            : defaultLanguageSlug

        const data = await runSearch({
          query: trimmed.slice(0, 200),
          limit: SEARCH_PAGE_SIZE,
          offset: 0,
          languageEnglishNames: activeLanguageEnglishNames,
          languageOptions: currentLanguageOptions,
          languageSlug: activeLanguageSlug,
          routeLanguageSlug,
        })

        if (requestIdRef.current !== thisRequest) return

        if (!data.ok) {
          setResults([])
          setDisplayResults([])
          setHasMore(false)
          setResultSource(data.resultSource)
          activeSearchSignatureRef.current = null
          setError(tSearchOverlay("searchFailed"))
          setAlgoliaSearchEnabled(data.resultSource === "algolia")
          if (data.languageFacets) {
            maybeSetLanguageFacets(
              data.languageFacets,
              activeLanguageEnglishNames,
            )
          }
          return
        }

        const newResults = data.results
        setResults(newResults)
        setDisplayResults(newResults)
        setResultsKey((k) => k + 1)
        setHasMore(data.hasMore)
        setResultSource(data.resultSource)
        const signatureLanguageSlug =
          data.resultSource === "semantic"
            ? data.resolvedLanguage.publicSlug
            : null
        activeSearchSignatureRef.current = {
          query: trimmed.slice(0, 200),
          languageEnglishNames: [...activeLanguageEnglishNames],
          languageSlug: signatureLanguageSlug,
          languageKey: searchLanguageKey(
            activeLanguageEnglishNames,
            signatureLanguageSlug,
          ),
          routeLanguageSlug,
          resultSource: data.resultSource,
          nextOffset: data.nextOffset ?? newResults.length,
        }
        setAlgoliaSearchEnabled(data.resultSource === "algolia")
        if (data.languageFacets) {
          maybeSetLanguageFacets(
            data.languageFacets,
            activeLanguageEnglishNames,
          )
        }
      } catch {
        if (requestIdRef.current === thisRequest) {
          activeSearchSignatureRef.current = null
          setError(tSearchOverlay("searchFailed"))
        }
      } finally {
        // Only clear loading state for the winning request — otherwise a
        // stale response's finally would drop the active spinner mid-fetch.
        clearLoadingForRequest(thisRequest)
      }
    },
    [
      clearLoadingForRequest,
      languageFacets,
      algoliaSearchEnabled,
      maybeSetLanguageFacets,
      pathname,
      refreshLanguageOptions,
      routeLanguageSlug,
      setQuery,
      tSearchOverlay,
    ],
  )

  const loadMore = useCallback(async (): Promise<void> => {
    const expectedSignature = activeSearchSignatureRef.current
    if (!expectedSignature) return
    const currentQuery = queryRef.current.trim().slice(0, 200)
    const currentLanguageSlug =
      resultSource === "algolia"
        ? null
        : (selectedSearchLanguageOptionRef.current?.publicSlug ??
          expectedSignature.languageSlug)
    const currentLanguageEnglishNames =
      selectedLanguageEnglishNamesRef.current.length > 0
        ? selectedLanguageEnglishNamesRef.current
        : expectedSignature.languageEnglishNames
    const currentLanguageKey = searchLanguageKey(
      currentLanguageEnglishNames,
      currentLanguageSlug,
    )
    if (
      expectedSignature.query !== currentQuery ||
      expectedSignature.languageKey !== currentLanguageKey ||
      expectedSignature.routeLanguageSlug !== routeLanguageSlug ||
      expectedSignature.resultSource !== resultSource
    ) {
      return
    }

    // Synchronous guard against double-fire before React commits `disabled`.
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    const thisLoadMoreRun = ++loadMoreRunIdRef.current
    setLoadingMore(true)
    setError(null)
    // Capture the current search's request id; bail out of the append if a
    // new search supersedes us mid-fetch.
    const thisRequest = requestIdRef.current
    try {
      const data = await runSearch({
        query: currentQuery,
        limit: SEARCH_PAGE_SIZE,
        offset: expectedSignature.nextOffset,
        languageEnglishNames: expectedSignature.languageEnglishNames,
        languageOptions: languageOptionsRef.current,
        languageSlug: expectedSignature.languageSlug,
        routeLanguageSlug,
      })
      if (requestIdRef.current !== thisRequest) return
      if (data.resultSource !== expectedSignature.resultSource) {
        setError(tSearchOverlay("loadMoreFailed"))
        return
      }
      if (!data.ok) {
        setError(tSearchOverlay("loadMoreFailed"))
        setAlgoliaSearchEnabled(data.resultSource === "algolia")
        return
      }
      setResults((prev) => [...prev, ...data.results])
      setDisplayResults((prev) => [...prev, ...data.results])
      setHasMore(data.hasMore)
      setResultSource(data.resultSource)
      activeSearchSignatureRef.current = {
        ...expectedSignature,
        nextOffset:
          data.nextOffset ?? expectedSignature.nextOffset + data.results.length,
      }
      setAlgoliaSearchEnabled(data.resultSource === "algolia")
    } catch {
      if (requestIdRef.current === thisRequest) {
        setError(tSearchOverlay("loadMoreFailed"))
      }
    } finally {
      if (loadMoreRunIdRef.current === thisLoadMoreRun) {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }, [resultSource, routeLanguageSlug, tSearchOverlay])

  const toggleSearchLanguage = useCallback(
    (option: SearchLanguageOption, regionName?: string): void => {
      const selected = selectedLanguageEnglishNamesRef.current.some(
        (language) => language === option.englishName,
      )
      if (
        !selected &&
        selectedLanguageEnglishNamesRef.current.length >=
          MAX_SEARCH_LANGUAGE_FILTERS
      ) {
        return
      }
      const nextLanguages = selected
        ? selectedLanguageEnglishNamesRef.current.filter(
            (language) => language !== option.englishName,
          )
        : normalizeSearchLanguageEnglishNames([
            ...selectedLanguageEnglishNamesRef.current,
            option.englishName,
          ])

      selectedLanguageEnglishNamesRef.current = nextLanguages
      setSelectedLanguageEnglishNames(nextLanguages)
      setSelectedLanguageRegionByName((prev) => {
        const next = { ...prev }
        if (selected) {
          delete next[option.englishName]
        } else if (regionName) {
          next[option.englishName] = regionName
        }
        return next
      })

      const nextQuery = selected
        ? query
        : stripLanguageFromSearchQuery(option.englishName, query)
      void search(nextQuery, { languageEnglishNames: nextLanguages })
    },
    [query, search],
  )

  const selectSearchLanguage = useCallback(
    (option: SearchLanguageOption, regionName?: string): void => {
      const nextLanguages = [option.englishName]
      searchLanguageSelectionUserSetRef.current = true
      selectedLanguageEnglishNamesRef.current = nextLanguages
      selectedSearchLanguageOptionRef.current = option.publicSlug
        ? option
        : null
      setSelectedLanguageEnglishNames(nextLanguages)
      setSelectedSearchLanguageOption(option.publicSlug ? option : null)
      setSelectedLanguageRegionByName(
        regionName ? { [option.englishName]: regionName } : {},
      )
    },
    [],
  )

  const resetSearchLanguageToDefault = useCallback((): void => {
    const defaultOption = defaultSearchLanguage
    searchLanguageSelectionUserSetRef.current = false
    selectedSearchLanguageOptionRef.current = defaultOption
    const nextLanguages = defaultOption ? [defaultOption.englishName] : []
    selectedLanguageEnglishNamesRef.current = nextLanguages
    setSelectedSearchLanguageOption(defaultOption)
    setSelectedLanguageEnglishNames(nextLanguages)
    setSelectedLanguageRegionByName(
      defaultOption?.regionNames[0]
        ? { [defaultOption.englishName]: defaultOption.regionNames[0] }
        : {},
    )
    if (query.trim().length > 0) {
      void search(query, {
        languageEnglishNames: nextLanguages,
        languageSlug: defaultOption?.publicSlug ?? null,
      })
    }
  }, [defaultSearchLanguage, query, search])

  const clearSearchLanguages = useCallback((): void => {
    selectedLanguageEnglishNamesRef.current = []
    setSelectedLanguageEnglishNames([])
    setSelectedLanguageRegionByName({})
    if (query.trim().length > 0) {
      void search(query, { languageEnglishNames: [] })
    }
  }, [query, search])

  const closeAndKeepQuery = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const resetTokenRef = useRef(resetToken)
  useEffect(() => {
    if (resetToken === 0 || resetTokenRef.current === resetToken) return
    resetTokenRef.current = resetToken
    void search("")
  }, [resetToken, search])

  // On first client mount, seed state from ?q= in the URL.
  const didHydrateRef = useRef(false)
  useEffect(() => {
    if (didHydrateRef.current) return
    didHydrateRef.current = true
    if (typeof window === "undefined") return
    const seeded = new URLSearchParams(window.location.search).get("q") ?? ""
    const trimmed = seeded.slice(0, 200)
    if (trimmed.length === 0) return
    hydratedOpenRef.current = true
    setQuery(trimmed)
    setOpen(true)
    void search(trimmed)
  }, [search, setOpen, setQuery])

  const value = useMemo<FloatingSearchContextValue>(
    () => ({
      open,
      closing,
      query,
      results,
      displayResults,
      exiting,
      resultsKey,
      hasMore,
      loading,
      showSkeleton,
      loadingMore,
      error,
      searched,
      resultSource,
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
      defaultSearchLanguageOption: defaultSearchLanguage,
      setOpen,
      setQuery,
      search,
      loadMore,
      toggleSearchLanguage,
      selectSearchLanguage,
      resetSearchLanguageToDefault,
      clearSearchLanguages,
      closeAndKeepQuery,
    }),
    [
      open,
      closing,
      query,
      results,
      displayResults,
      exiting,
      resultsKey,
      hasMore,
      loading,
      showSkeleton,
      loadingMore,
      error,
      searched,
      resultSource,
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
      defaultSearchLanguage,
      setOpen,
      setQuery,
      search,
      loadMore,
      toggleSearchLanguage,
      selectSearchLanguage,
      resetSearchLanguageToDefault,
      clearSearchLanguages,
      closeAndKeepQuery,
    ],
  )

  const modalChromeHidden = open || closing

  return (
    <FloatingSearchContext.Provider value={value}>
      {children}
      {portalReady && modalChromeHidden
        ? createPortal(<SearchOverlay />, document.body)
        : null}
    </FloatingSearchContext.Provider>
  )
}

function searchLanguageKey(
  languageEnglishNames: readonly string[],
  languageSlug: string | null,
): string {
  return [
    languageSlug ?? "",
    normalizeSearchLanguageEnglishNames(languageEnglishNames).join("\u0001"),
  ].join("\u0002")
}

function withSearchLanguageOptionsFallback(
  promise: Promise<SearchLanguageOption[]>,
  fallback: () => SearchLanguageOption[],
): Promise<SearchLanguageOption[]> {
  return new Promise((resolve) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback())
    }, SEARCH_LANGUAGE_OPTIONS_FALLBACK_MS)

    promise.then(
      (options) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(options)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(fallback())
      },
    )
  })
}

function defaultSearchLanguageOption({
  options,
  routeLanguageSlug,
  recommendedLanguage,
}: {
  options: readonly SearchLanguageOption[]
  routeLanguageSlug: string | null
  recommendedLanguage: SearchLanguageOption | null
}): SearchLanguageOption | null {
  if (routeLanguageSlug) {
    const routeOption = findSearchLanguageOptionByPublicSlug(
      routeLanguageSlug,
      options,
    )
    if (routeOption) return routeOption
  }

  if (recommendedLanguage?.publicSlug) return recommendedLanguage

  return findSearchLanguageOptionByPublicSlug("english", options)
}
