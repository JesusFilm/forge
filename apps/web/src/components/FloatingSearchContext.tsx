"use client"

import { createContext, useContext } from "react"
import type { Route } from "next"

import type { SearchActionResultSource, SearchResult } from "@/lib/search"
import type {
  SearchLanguageCountrySuggestion,
  SearchLanguageOption,
  SearchLanguageRegionGroup,
} from "@/lib/search-language"
import type { WatchSearchResultClickAnalytics } from "@/lib/watch-search-analytics-contract"
import type { WatchSearchErrorKind } from "@/lib/watch-search-client"

export type FloatingSearchResultAnalyticsContext = Omit<
  WatchSearchResultClickAnalytics,
  "position"
>

export type FloatingSearchContextValue = {
  open: boolean
  closing: boolean
  query: string
  submittedQuery: string | null
  results: SearchResult[]
  displayResults: SearchResult[]
  exiting: boolean
  resultsKey: number
  hasMore: boolean
  loading: boolean
  showSkeleton: boolean
  loadingMore: boolean
  error: string | null
  errorKind: WatchSearchErrorKind | null
  searched: boolean
  resultSource: SearchActionResultSource | null
  languageOptions: SearchLanguageOption[]
  languageGroups: SearchLanguageRegionGroup[]
  languageCountrySuggestion: SearchLanguageCountrySuggestion | null
  recommendedLanguage: SearchLanguageOption | null
  languageOptionsLoaded: boolean
  languageOptionsLoading: boolean
  languageOptionsError: string | null
  selectedLanguageEnglishNames: string[]
  selectedLanguageRegionByName: Record<string, string>
  selectedSearchLanguageOption: SearchLanguageOption | null
  searchResultAnalytics: FloatingSearchResultAnalyticsContext | null
  defaultSearchLanguageOption: SearchLanguageOption | null
  headerLanguageSwitcherVisible: boolean
  headerLanguageCode: string | null
  headerPinned: boolean
  /**
   * Inventory path for the header language, or null when that language has no
   * public inventory route. Derived once in FloatingSearchProvider so the
   * header control and the search overlay's mobile row can never disagree
   * about which language "all videos" means.
   */
  languageVideosHref: Route | null
  setOpen: (open: boolean) => void
  setQuery: (q: string) => void
  search: (
    q: string,
    options?: {
      languageEnglishNames?: string[]
      languageSlug?: string | null
      languageSlugIsExplicit?: boolean
    },
  ) => Promise<void>
  loadMore: () => Promise<void>
  toggleSearchLanguage: (
    option: SearchLanguageOption,
    regionName?: string,
  ) => void
  selectSearchLanguage: (
    option: SearchLanguageOption,
    regionName?: string,
  ) => void
  resetSearchLanguageToDefault: () => void
  clearSearchLanguages: () => void
}

export type FloatingSearchPinnedContextValue = {
  pinned: boolean
  playerChromeVisible: boolean
  searchChromeVisible: boolean
  searchChromeDimmed: boolean
  // True while the search overlay is open OR running its close animation.
  // Watch-page modal coordinators read this to pause/resume the video
  // alongside their own (download / language / share) modal state.
  searchOpen: boolean
}

export type WatchRouteSurface = "language-home" | "experience" | "english-video"

export type WatchRouteSurfaceContextValue = {
  surface: WatchRouteSurface | null
  register: (pathname: string, surface: WatchRouteSurface) => () => void
}

export const FloatingSearchContext =
  createContext<FloatingSearchContextValue | null>(null)

export const FloatingSearchPinnedContext =
  createContext<FloatingSearchPinnedContextValue | null>(null)

export const WatchRouteSurfaceContext =
  createContext<WatchRouteSurfaceContextValue | null>(null)

export function useFloatingSearch(): FloatingSearchContextValue {
  const ctx = useContext(FloatingSearchContext)
  if (ctx === null) {
    throw new Error(
      "useFloatingSearch must be used inside <FloatingSearchProvider>",
    )
  }
  return ctx
}

export function useFloatingSearchPinned(): FloatingSearchPinnedContextValue {
  const ctx = useContext(FloatingSearchPinnedContext)
  if (ctx === null) {
    throw new Error(
      "useFloatingSearchPinned must be used inside <FloatingSearchProvider>",
    )
  }
  return ctx
}

export function useWatchRouteSurface(): WatchRouteSurface | null {
  return useContext(WatchRouteSurfaceContext)?.surface ?? null
}

export function useWatchRouteSurfaceRegistration(): WatchRouteSurfaceContextValue {
  const ctx = useContext(WatchRouteSurfaceContext)
  if (ctx === null) {
    throw new Error(
      "useWatchRouteSurfaceRegistration must be used inside <FloatingSearchProvider>",
    )
  }
  return ctx
}
