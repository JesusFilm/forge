/**
 * Shared PostgreSQL advisory lock for current-index publication and candidate
 * lease admission. A publisher holds the session lock for the full Typesense
 * operation; lease acquisition probes the same key transactionally.
 */
export const TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID = 1_179_605_063
