"use client"

import { createContext, useContext } from "react"

import type { SearchActionResultSource, SearchResult } from "@/lib/search"
import type {
  SearchLanguageCountrySuggestion,
  SearchLanguageOption,
  SearchLanguageRegionGroup,
} from "@/lib/search-language"
import type { WatchSearchResultClickAnalytics } from "@/lib/watch-search-analytics-contract"

export type FloatingSearchResultAnalyticsContext = Omit<
  WatchSearchResultClickAnalytics,
  "position"
>

export type FloatingSearchContextValue = {
  open: boolean
  closing: boolean
  query: string
  results: SearchResult[]
  displayResults: SearchResult[]
  exiting: boolean
  resultsKey: number
  hasMore: boolean
  loading: boolean
  showSkeleton: boolean
  loadingMore: boolean
  error: string | null
  searched: boolean
  resultSource: SearchActionResultSource | null
  algoliaSearchEnabled: boolean
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
  setOpen: (open: boolean) => void
  setQuery: (q: string) => void
  search: (
    q: string,
    options?: { languageEnglishNames?: string[]; languageSlug?: string | null },
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
  closeAndKeepQuery: () => void
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

export const FloatingSearchContext =
  createContext<FloatingSearchContextValue | null>(null)

export const FloatingSearchPinnedContext =
  createContext<FloatingSearchPinnedContextValue | null>(null)

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
