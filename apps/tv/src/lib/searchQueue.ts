// Pure admission/re-fire decisions, extracted because TV has no
// @testing-library/react-native. Only reachable since the watchSearch migration
// restored a real `await` — the old shim never had anything in flight.

export type RunSearchAdmission =
  /** A request is already in flight; the settle path re-checks the live query. */
  | { readonly kind: "in-flight" }
  /** Nothing to search. */
  | { readonly kind: "empty" }
  /** Proceed with the request. */
  | { readonly kind: "start"; readonly trimmed: string }

/** Decides whether a runSearch call proceeds. */
export function admitRunSearch(
  query: string,
  isSubmitting: boolean,
): RunSearchAdmission {
  if (isSubmitting) return { kind: "in-flight" }
  const trimmed = query.trim()
  if (trimmed.length === 0) return { kind: "empty" }
  return { kind: "start", trimmed }
}

/**
 * Whether the caller must clear the skip-next-debounce flag. ONLY on "empty".
 * An in-flight bail must KEEP the flag set: the settle path re-fires from the
 * live query, so releasing it here would let the debounce fire a duplicate.
 */
export function releasesSkipFlag(admission: RunSearchAdmission): boolean {
  return admission.kind === "empty"
}

/**
 * Whether the settle path should chase a query the in-flight guard dropped.
 * Reads the LIVE query rather than a captured one, so an abandoned term can
 * never resurrect; a still-scheduled debounce owns the retry itself.
 */
export function shouldRefireLiveQuery(
  liveQuery: string,
  justRanTrimmed: string,
  debounceScheduled: boolean,
): boolean {
  if (debounceScheduled) return false
  const live = liveQuery.trim()
  return live.length > 0 && live !== justRanTrimmed
}
