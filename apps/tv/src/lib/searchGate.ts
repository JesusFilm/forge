// The typed-search input gate, kept dependency-free (no Apollo/React imports) so
// it is unit-testable without dragging the whole search hook into jest. Both the
// debounce path (useSemanticSearch) and the results-vs-browse switch (app/search)
// use it, so the two stay in lockstep.

/** Minimum trimmed length before a TYPED query fires the semantic search. Each
 *  new prefix is a server-side cold embedding on a miss; gating to >=3 chars
 *  drops the single/double-letter hits. Explicit submit/category/recent paths
 *  bypass this (they carry a known term) — the gate lives only on the debounce
 *  path (KTD5). */
export const MIN_QUERY_LENGTH = 3

/** True when a trimmed query is long enough to fire the typed search AND to show
 *  results instead of the browse view. One lockstep gate for both call sites. */
export function meetsMinQueryLength(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH
}
