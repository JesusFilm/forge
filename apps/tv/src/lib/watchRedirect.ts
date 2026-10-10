// Pure, React-free redirect for /watch/[slug] — mirror seam of seriesScreenState's
// resolveLeafBounce. Both seams read the ONE isSeriesLabel predicate, which is what
// makes them exact inverses and unable to loop; a second predicate would break that.

import { isSeriesLabel } from "./isSeriesRecord"

export type WatchRedirectDecision = "stay" | "redirect" | "pending"

/**
 * Should a /watch record redirect to /series? "redirect": SERIES/COLLECTION label
 * (label-ONLY — lean fragment has no children signal). "stay": no series label
 * (mirrors mobile). "pending": no record or in-flight — never redirect off cache.
 */
export function resolveWatchRedirect(
  record: { label: string | null } | null | undefined,
  { loading }: { loading: boolean },
): WatchRedirectDecision {
  if (record == null) return "pending"
  if (loading) return "pending"
  return isSeriesLabel(record.label) ? "redirect" : "stay"
}
