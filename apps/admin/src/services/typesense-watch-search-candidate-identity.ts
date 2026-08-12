/**
 * Compatibility identity for the candidate Watch search implementation.
 *
 * Keep this stable across unrelated Admin deployments. Bump it whenever a
 * candidate query, ranking, or index contract change requires a rebuilt and
 * requalified candidate generation.
 */
export const TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION =
  "watch-search-candidate/v1"

export function candidateWatchSearchApplicationRevision(): string {
  return TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION
}
