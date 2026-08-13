import { WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION } from "./typesense-watch-search-ranking"

/**
 * Compatibility identity for the candidate Watch search physical projection.
 *
 * Keep this stable across unrelated Admin deployments. Bump it whenever a
 * candidate schema, document projection, or retrieval contract change requires
 * rebuilt physical collections.
 */
export const TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION =
  "watch-search-candidate/v2" as const

/** Qualification identity for application-side candidate ranking behavior. */
export const TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION =
  WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION

export function candidateWatchSearchApplicationRevision(): typeof TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION {
  return TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION
}

export function candidateWatchSearchRankingRevision(): typeof TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION {
  return TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION
}
