import { WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION } from "./typesense-watch-search-ranking"

/**
 * Compatibility identity for the candidate Watch search physical projection.
 *
 * Keep this stable across unrelated Admin deployments. Bump it whenever a
 * candidate schema, document projection, or retrieval contract change requires
 * rebuilt physical collections.
 *
 * v3 adds `containerLanguagesJson` to the catalog document projection and to
 * the catalog retrieval-field contract. The field is stored UNDECLARED, so the
 * collection's field manifest is unchanged — but that only settles whether
 * Typesense accepts the field, not whether an older generation can still serve
 * today's code. A generation built before this change carries documents with no
 * such key, so every container in it resolves `unavailable`: exactly the defect
 * this work removes. Without the bump that stale generation stays compatible,
 * and could requalify and be promoted with the benchmark green while serving
 * the bug. Bumping forces a fresh generation instead.
 */
export const TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION =
  "watch-search-candidate/v3" as const

/** Qualification identity for application-side candidate ranking behavior. */
export const TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION =
  WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION

export function candidateWatchSearchApplicationRevision(): typeof TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION {
  return TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION
}

export function candidateWatchSearchRankingRevision(): typeof TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION {
  return TYPESENSE_WATCH_SEARCH_CANDIDATE_RANKING_REVISION
}
