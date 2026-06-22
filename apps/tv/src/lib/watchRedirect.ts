// Pure, React-free redirect for /watch/[slug] — mirror seam of seriesScreenState's
// resolveLeafBounce (watch → /series for label-series, series → /watch for leaves).
// Predicates partition (isSeriesLabel ⊂ isSeriesRecord) so the seams can't loop.

import { isSeriesLabel } from "./isSeriesRecord"

export type WatchRedirectDecision = "stay" | "redirect" | "pending"

/**
 * Should a /watch record redirect to /series? "redirect": SERIES/COLLECTION
 * label (label-ONLY here — lean fragment has no children signal). "stay": no
 * series label (accepted gap, mirrors mobile: unlabeled-with-children stays).
 * "pending": no record or in-flight — never redirect off partial cache data.
 */
export function resolveWatchRedirect(
  record: { label: string | null } | null | undefined,
  { loading }: { loading: boolean },
): WatchRedirectDecision {
  if (record == null) return "pending"
  if (loading) return "pending"
  return isSeriesLabel(record.label) ? "redirect" : "stay"
}
