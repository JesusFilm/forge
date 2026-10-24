/**
 * Recognises a request the CLIENT cancelled (a deadline or an unmount), as
 * opposed to a server failure. Shared by the Apollo error link and the
 * recommendation client so the two classifiers cannot drift.
 */
const MAX_CAUSE_DEPTH = 3

// Typed marker FIRST: RN rejects a cancelled request as a name-less
// Error("Aborted"), so name alone missed 400 prod aborts. Never match on message
// text — a server error could legitimately say "Aborted".
export function isClientAbortError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error == null) return false
  const candidate = error as {
    name?: unknown
    isClientAbort?: unknown
    cause?: unknown
  }
  if (candidate.isClientAbort === true) return true
  if (candidate.name === "AbortError") return true
  // Apollo may wrap the abort. Depth-bounded: an unbounded walk lets a cause
  // CYCLE throw RangeError out of reportGraphqlOperationError, which has no
  // safeDatadogCall wrapper and would escape into the Apollo error link.
  if (depth >= MAX_CAUSE_DEPTH || candidate.cause == null) return false
  return isClientAbortError(candidate.cause, depth + 1)
}
