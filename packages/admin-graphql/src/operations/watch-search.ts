import { adminGraphql } from "../index"

export const adminWatchSearchQuery = `
  query WatchSearch($input: WatchSearchInput!) {
    watchSearch(input: $input) {
      requestId
      query
      degraded
      laneStatuses {
        lane
        status
        elapsedMs
        resultCount
        reason
      }
      languageInterpretation {
        targetLanguageSlug
      }
      results {
        type
        id
        slug
        title
        imageUrl
        imageBlurDataUrl
        muxThumbnailBlurDataUrl
        snippet
        playbackId
        startSeconds
        score
        label
        durationSeconds
        childCount
        languageSlug
        languageEnglishName
        availability {
          kind
          languageSlug
          languageEnglishName
        }
        evidence {
          label
          languageSlug
        }
        action {
          hrefLanguageSlug
        }
      }
      hasMore
      searchMode
      latencyMs
      nextOffset
    }
  }
` as const

export const adminWatchSearchOperation = adminGraphql(adminWatchSearchQuery)

export const adminWatchSearchSuggestionsQuery = `
  query WatchSearchSuggestions($input: WatchSearchSuggestionsInput!) {
    watchSearchSuggestions(input: $input) {
      kind
      title
      description
      matchSource
      id
      slug
      label
      childCount
    }
  }
` as const

export const adminWatchSearchSuggestionsOperation = adminGraphql(
  adminWatchSearchSuggestionsQuery,
)
