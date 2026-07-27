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
import { useLocale, useTranslations } from "next-intl"

import { isPublicWatchLanguageSlug } from "@/lib/locale"
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
import { detectQueryLanguageSuggestion } from "@/lib/search-query-language"
import { parseWatchPath } from "@/lib/routes"
import { WATCH_SEARCH_ANALYTICS_SURFACE } from "@/lib/watch-search-analytics-contract"
import {
  FloatingSearchContext,
  type FloatingSearchContextValue,
  type FloatingSearchResultAnalyticsContext,
  useWatchRouteSurface,
} from "./FloatingSearchContext"

import { SearchOverlay } from "./SearchOverlay"

const SEARCH_PAGE_SIZE = 10
const SEARCH_LANGUAGE_OPTIONS_FALLBACK_MS = 1200
const DEFAULT_LANGUAGE_OPTIONS_CACHE_KEY = "__default__"

type SearchLanguageOptionsResponse = Awaited<
  ReturnType<typeof getSearchLanguageOptions>
>

const searchLanguageOptionsCache = new Map<
  string,
  SearchLanguageOptionsResponse
>()
const searchLanguageOptionsPromiseCache = new Map<
  string,
  Promise<SearchLanguageOptionsResponse>
>()

export function resetSearchLanguageOptionsCacheForTest(): void {
  searchLanguageOptionsCache.clear()
  searchLanguageOptionsPromiseCache.clear()
}

type ActiveSearchSignature = {
  query: string
  languageEnglishNames: string[]
  languageSlug: string | null
  languageSlugIsExplicit: boolean
  routeLanguageSlug: string | null
  resultSource: SearchActionResultSource
  nextOffset: number
  searchLanguageEnglishName: string | null
  searchLanguageSlug: string | null
  searchRequestId: string
  detectedQueryLanguage: string | null
}

export type FloatingSearchControllerProps = {
  open: boolean
  closing: boolean
  query: string
  setOpen: (open: boolean) => void
  setQuery: (query: string) => void
  headerLanguageSwitcherVisible?: boolean
  headerLanguageCode?: string | null
  headerPinned?: boolean
  resetToken?: number
  onReady?: () => void
  children?: ReactNode
}

export function FloatingSearchController({
  open,
  closing,
  query,
  setOpen,
  setQuery: setQueryState,
  headerLanguageSwitcherVisible = false,
  headerLanguageCode = null,
  headerPinned = false,
  resetToken = 0,
  onReady,
  children,
}: FloatingSearchControllerProps) {
  const tSearchOverlay = useTranslations("SearchOverlay")
  const uiLocale = useLocale()
  // usePathname() does NOT force the Full Route Cache deopt that
  // useSearchParams() would. Keep it only for route-language parsing.
  const pathname = usePathname()
  const routeSurface = useWatchRouteSurface()

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
  const [searchResultAnalytics, setSearchResultAnalytics] =
    useState<FloatingSearchResultAnalyticsContext | null>(null)

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
  useEffect(() => {
    if (!portalReady) return
    onReady?.()
  }, [onReady, portalReady])

  const languageGroups = useMemo(
    () => groupSearchLanguagesByRegion(languageOptions),
    [languageOptions],
  )
  const routeLanguageSlug = useMemo(() => {
    const parsed = parseWatchPath(pathname)
    if (routeSurface === "english-video") return "english"
    if (routeSurface === "experience") return null
    if (routeSurface === "language-home" && parsed.kind === "localized-home") {
      return isPublicWatchLanguageSlug(parsed.lang) ? parsed.lang : null
    }
    if (!("lang" in parsed)) return null
    return isPublicWatchLanguageSlug(parsed.lang) ? parsed.lang : null
  }, [pathname, routeSurface])
  const defaultSearchLanguage = useMemo(
    () =>
      defaultSearchLanguageOption({
        options: languageOptions,
        routeLanguageSlug,
        recommendedLanguage,
      }),
    [languageOptions, recommendedLanguage, routeLanguageSlug],
  )

  const applyLanguageOptionsResponse = useCallback(
    (response: SearchLanguageOptionsResponse): SearchLanguageOption[] => {
      if (response.ok) {
        setLanguageOptions(response.options)
        setLanguageCountrySuggestion(response.countrySuggestion)
        setRecommendedLanguage(response.recommendedLanguage)
        if (!searchLanguageSelectionUserSetRef.current) {
          selectedSearchLanguageOptionRef.current = null
          selectedLanguageEnglishNamesRef.current = []
          setSelectedSearchLanguageOption(null)
          setSelectedLanguageEnglishNames([])
          setSelectedLanguageRegionByName({})
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
    },
    [],
  )

  const refreshLanguageOptions = useCallback(
    async (
      availableLanguageFacets?: Record<string, number>,
    ): Promise<SearchLanguageOption[]> => {
      const cacheKey = searchLanguageOptionsCacheKey(availableLanguageFacets)
      const thisRequest = ++languageOptionsRequestIdRef.current
      const cachedResponse = searchLanguageOptionsCache.get(cacheKey)

      if (cachedResponse != null) {
        languageOptionsLoadedRef.current = true
        setLanguageOptionsLoaded(true)
        setLanguageOptionsLoading(false)
        setLanguageOptionsError(null)
        return applyLanguageOptionsResponse(cachedResponse)
      }

      languageOptionsLoadedRef.current = false
      setLanguageOptionsLoaded(false)
      setLanguageOptionsLoading(true)
      setLanguageOptionsError(null)

      try {
        let responsePromise = searchLanguageOptionsPromiseCache.get(cacheKey)
        if (responsePromise == null) {
          responsePromise = getSearchLanguageOptions({
            availableLanguageFacets,
          })
          searchLanguageOptionsPromiseCache.set(cacheKey, responsePromise)
        }
        const response = await responsePromise
        if (response.ok) {
          searchLanguageOptionsCache.set(cacheKey, response)
        }
        if (languageOptionsRequestIdRef.current !== thisRequest) {
          return response.ok ? response.options : []
        }
        return applyLanguageOptionsResponse(response)
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
        searchLanguageOptionsPromiseCache.delete(cacheKey)
        if (languageOptionsRequestIdRef.current === thisRequest) {
          languageOptionsLoadedRef.current = true
          setLanguageOptionsLoaded(true)
          setLanguageOptionsLoading(false)
        }
      }
    },
    [applyLanguageOptionsResponse],
  )

  useEffect(() => {
    if (searchLanguageSelectionUserSetRef.current) return
    selectedSearchLanguageOptionRef.current = null
    setSelectedSearchLanguageOption(null)
    selectedLanguageEnglishNamesRef.current = []
    setSelectedLanguageEnglishNames([])
    setSelectedLanguageRegionByName({})
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
      setLanguageFacets((currentLanguageFacets) =>
        languageFacetsEqual(currentLanguageFacets, nextLanguageFacets)
          ? currentLanguageFacets
          : nextLanguageFacets,
      )
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
        languageSlugIsExplicit?: boolean
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
      setSearchResultAnalytics(null)
      setLoadingMore(false)

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
        setSearchResultAnalytics(null)
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
      skeletonTimerRef.current = setTimeout(() => {
        if (requestIdRef.current === thisRequest) setShowSkeleton(true)
      }, 500)

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
        const defaultLanguageSlug =
          selectedSearchLanguageOptionRef.current?.publicSlug ?? null
        const activeLanguageSlug =
          options?.languageSlug !== undefined
            ? options.languageSlug
            : defaultLanguageSlug
        const activeLanguageSlugIsExplicit =
          options?.languageSlugIsExplicit ??
          (options?.languageSlug !== undefined ||
            searchLanguageSelectionUserSetRef.current)
        const cappedQuery = trimmed.slice(0, 200)
        const searchRequestId = createSearchRequestId()
        const searchLanguageSlug =
          activeLanguageSlug ??
          selectedSearchLanguageOptionRef.current?.publicSlug ??
          null
        const detectedQueryLanguage = detectWatchQueryLanguage({
          currentLanguageSlug: searchLanguageSlug ?? routeLanguageSlug,
          languageOptions: currentLanguageOptions,
          query: cappedQuery,
        })

        const data = await runSearch({
          query: cappedQuery,
          limit: SEARCH_PAGE_SIZE,
          offset: 0,
          languageEnglishNames: activeLanguageEnglishNames,
          languageOptions: currentLanguageOptions,
          languageSlug: activeLanguageSlug,
          languageSlugIsExplicit: activeLanguageSlugIsExplicit,
          routeLanguageSlug,
          uiLocale,
          analytics: {
            detectedQueryLanguage,
            requestType: "search",
            searchRequestId,
            surface: WATCH_SEARCH_ANALYTICS_SURFACE,
            visibleResultCount: 0,
          },
        })

        if (requestIdRef.current !== thisRequest) return

        if (!data.ok) {
          setResults([])
          setDisplayResults([])
          setHasMore(false)
          setResultSource(data.resultSource)
          activeSearchSignatureRef.current = null
          setSearchResultAnalytics(null)
          setError(tSearchOverlay("searchFailed"))
          if (data.languageFacets) {
            maybeSetLanguageFacets(
              data.languageFacets,
              activeLanguageEnglishNames,
            )
          }
          return
        }

        const newResults = data.results
        const responseSearchRequestId = data.requestId ?? searchRequestId
        setResults(newResults)
        setDisplayResults(newResults)
        setResultsKey((k) => k + 1)
        setHasMore(data.hasMore)
        setResultSource(data.resultSource)
        const signatureLanguageSlug = activeLanguageSlugIsExplicit
          ? data.resolvedLanguage.publicSlug
          : null
        const searchLanguageEnglishName = activeLanguageEnglishNames[0] ?? null
        activeSearchSignatureRef.current = {
          query: cappedQuery,
          languageEnglishNames: [...activeLanguageEnglishNames],
          languageSlug: signatureLanguageSlug,
          languageSlugIsExplicit: activeLanguageSlugIsExplicit,
          routeLanguageSlug,
          resultSource: data.resultSource,
          nextOffset: data.nextOffset ?? newResults.length,
          searchLanguageEnglishName,
          searchLanguageSlug: searchLanguageSlug ?? signatureLanguageSlug,
          searchRequestId: responseSearchRequestId,
          detectedQueryLanguage,
        }
        setSearchResultAnalytics({
          resultSource: data.resultSource,
          routeLanguageSlug,
          searchLanguageEnglishName,
          searchLanguageSlug: searchLanguageSlug ?? signatureLanguageSlug,
          searchRequestId: responseSearchRequestId,
        })
        if (data.languageFacets) {
          maybeSetLanguageFacets(
            data.languageFacets,
            activeLanguageEnglishNames,
          )
        }
      } catch {
        if (requestIdRef.current === thisRequest) {
          activeSearchSignatureRef.current = null
          setSearchResultAnalytics(null)
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
      maybeSetLanguageFacets,
      refreshLanguageOptions,
      routeLanguageSlug,
      setQuery,
      tSearchOverlay,
      uiLocale,
    ],
  )

  const loadMore = useCallback(async (): Promise<void> => {
    const expectedSignature = activeSearchSignatureRef.current
    if (!expectedSignature) return
    const currentQuery = queryRef.current.trim().slice(0, 200)
    if (
      expectedSignature.query !== currentQuery ||
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
        languageSlugIsExplicit: expectedSignature.languageSlugIsExplicit,
        routeLanguageSlug,
        uiLocale,
        analytics: {
          detectedQueryLanguage: expectedSignature.detectedQueryLanguage,
          expectedResultSource: expectedSignature.resultSource,
          requestType: "load_more",
          searchRequestId: expectedSignature.searchRequestId,
          surface: WATCH_SEARCH_ANALYTICS_SURFACE,
          visibleResultCount: displayResultsRef.current.length,
        },
      })
      if (requestIdRef.current !== thisRequest) return
      if (data.resultSource !== expectedSignature.resultSource) {
        setError(tSearchOverlay("loadMoreFailed"))
        return
      }
      if (!data.ok) {
        setError(tSearchOverlay("loadMoreFailed"))
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
      setSearchResultAnalytics({
        resultSource: data.resultSource,
        routeLanguageSlug,
        searchLanguageEnglishName: expectedSignature.searchLanguageEnglishName,
        searchLanguageSlug: expectedSignature.searchLanguageSlug,
        searchRequestId: expectedSignature.searchRequestId,
      })
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
  }, [resultSource, routeLanguageSlug, tSearchOverlay, uiLocale])

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
    searchLanguageSelectionUserSetRef.current = false
    selectedSearchLanguageOptionRef.current = null
    selectedLanguageEnglishNamesRef.current = []
    setSelectedSearchLanguageOption(null)
    setSelectedLanguageEnglishNames([])
    setSelectedLanguageRegionByName({})
    if (query.trim().length > 0) {
      void search(query, {
        languageEnglishNames: [],
        languageSlug: null,
        languageSlugIsExplicit: false,
      })
    }
  }, [query, search])

  const clearSearchLanguages = useCallback((): void => {
    selectedLanguageEnglishNamesRef.current = []
    setSelectedLanguageEnglishNames([])
    setSelectedLanguageRegionByName({})
    if (query.trim().length > 0) {
      void search(query, { languageEnglishNames: [] })
    }
  }, [query, search])

  const initialShellQueryRef = useRef(query)
  const initialShellQueryConsumedRef = useRef(false)
  useEffect(() => {
    if (initialShellQueryConsumedRef.current) return
    const initialShellQuery = initialShellQueryRef.current
    if (!open || searched || initialShellQuery.trim().length === 0) return
    initialShellQueryConsumedRef.current = true
    void search(initialShellQuery)
  }, [open, search, searched])

  const resetTokenRef = useRef(resetToken)
  useEffect(() => {
    if (resetToken === 0 || resetTokenRef.current === resetToken) return
    resetTokenRef.current = resetToken
    void search("")
  }, [resetToken, search])

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
      defaultSearchLanguageOption: defaultSearchLanguage,
      headerLanguageSwitcherVisible,
      headerLanguageCode,
      headerPinned,
      setOpen,
      setQuery,
      search,
      loadMore,
      toggleSearchLanguage,
      selectSearchLanguage,
      resetSearchLanguageToDefault,
      clearSearchLanguages,
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
      defaultSearchLanguage,
      headerLanguageSwitcherVisible,
      headerLanguageCode,
      headerPinned,
      setOpen,
      setQuery,
      search,
      loadMore,
      toggleSearchLanguage,
      selectSearchLanguage,
      resetSearchLanguageToDefault,
      clearSearchLanguages,
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

function createSearchRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  const entropy = Math.random().toString(36).slice(2, 12)
  return `${Date.now().toString(36)}_${entropy}`
}

function detectWatchQueryLanguage({
  currentLanguageSlug,
  languageOptions,
  query,
}: {
  currentLanguageSlug: string | null
  languageOptions: readonly SearchLanguageOption[]
  query: string
}): string | null {
  return (
    detectQueryLanguageSuggestion({
      currentLanguageSlug,
      languageOptions,
      query,
    })?.option.publicSlug ?? null
  )
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

function languageFacetsEqual(
  current: Record<string, number>,
  next: Record<string, number>,
): boolean {
  const currentEntries = Object.entries(current)
  const nextEntries = Object.entries(next)
  if (currentEntries.length !== nextEntries.length) return false

  for (const [language, count] of nextEntries) {
    if (current[language] !== count) return false
  }
  return true
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

function searchLanguageOptionsCacheKey(
  availableLanguageFacets?: Record<string, number>,
): string {
  if (
    availableLanguageFacets == null ||
    Object.keys(availableLanguageFacets).length === 0
  ) {
    return DEFAULT_LANGUAGE_OPTIONS_CACHE_KEY
  }

  return Object.entries(availableLanguageFacets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, count]) => `${language}:${count}`)
    .join("|")
}
