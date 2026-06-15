// Pure, React-free redirect decision for the /watch/[slug] screen — the
// mirror seam of seriesScreenState's resolveLeafBounce. Watch redirects
// label-series records to /series; series bounces leaves back to /watch.
// Both sides replace, and the predicates partition (isSeriesLabel here is a
// strict subset of the series screen's isSeriesRecord), so the seams can
// never disagree and loop.

import { isSeriesLabel } from "./isSeriesRecord"

export type WatchRedirectDecision = "stay" | "redirect" | "pending"

/**
 * Should a record that landed on /watch redirect to /series?
 *
 * - "redirect": complete data with a SERIES/COLLECTION label. Detection is
 *   label-ONLY at this seam — the lean watch fragment doesn't fetch the
 *   video's own children, so there is no episodes signal here.
 * - "stay": complete data without a series label. This includes the accepted
 *   gap (mirrors mobile): an UNLABELED record with children stays on the
 *   watch screen.
 * - "pending": no record yet, or the query is still in flight — a partial
 *   cache read (cache-first + returnPartialData) may be missing its label,
 *   so neither branch is decidable. Never redirect off partial cache data.
 */
export function resolveWatchRedirect(
  record: { label: string | null } | null | undefined,
  { loading }: { loading: boolean },
): WatchRedirectDecision {
  if (record == null) return "pending"
  if (loading) return "pending"
  return isSeriesLabel(record.label) ? "redirect" : "stay"
}
