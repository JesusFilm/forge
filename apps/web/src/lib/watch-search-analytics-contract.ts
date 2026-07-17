import type { SearchActionResultSource } from "./search"

export const WATCH_SEARCH_ANALYTICS_SURFACE = "watch-search" as const
export const WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION =
  "watch_search.result_clicked" as const

export type WatchSearchRequestType = "load_more" | "search"

export type WatchSearchAnalyticsContext = {
  audioLanguageSlug?: string | null
  pageRoute?: string | null
  playbackPositionSeconds?: number | null
  referrerOrigin?: string | null
  routeLanguageSlug?: string | null
  videoId?: string | null
  videoSlug?: string | null
}

export type WatchSearchAnalyticsInput = {
  detectedQueryLanguage?: string | null
  expectedResultSource?: SearchActionResultSource | null
  requestType?: WatchSearchRequestType | null
  searchRequestId?: string | null
  surface?: string | null
  visibleResultCount?: number | null
  watchContext?: WatchSearchAnalyticsContext | null
}

export type WatchSearchResultClickAnalytics = {
  resultSource: SearchActionResultSource
  routeLanguageSlug?: string | null
  searchLanguageEnglishName?: string | null
  searchLanguageSlug?: string | null
  searchRequestId: string
  position: number
}
