import { WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION } from "./typesense-watch-search-ranking"

/**
 * Watch Search Index Contract Revision for the candidate physical projection.
 *
 * Keep this stable across unrelated Admin deployments. Bump it whenever a
 * candidate schema, document projection, or retrieval contract change requires
 * rebuilt physical collections.
 *
 * v4 links each candidate lexical collection to the versioned curation set
 * compiled from the same PostgreSQL snapshot. A v3 generation has no such link
 * and would silently omit editorial results while otherwise looking compatible.
 * Bumping forces publication and qualification of a fresh generation.
 */
export const TYPESENSE_WATCH_SEARCH_INDEX_CONTRACT_REVISION =
  "watch-search-candidate/v4" as const

/** Qualification identity for application-side candidate ranking behavior. */
export const TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION =
  WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION

export function candidateWatchSearchIndexContractRevision(): typeof TYPESENSE_WATCH_SEARCH_INDEX_CONTRACT_REVISION {
  return TYPESENSE_WATCH_SEARCH_INDEX_CONTRACT_REVISION
}

export function candidateWatchSearchRankingRevision(): typeof TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION {
  return TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION
}
