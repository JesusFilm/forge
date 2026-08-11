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
