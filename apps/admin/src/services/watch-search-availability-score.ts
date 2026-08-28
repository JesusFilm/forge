import type { WatchSearchAvailabilityKind } from "./watch-search.service"

/**
 * Ranking contribution of a Search Watchability state, owned here because three
 * surfaces read it: live ranking in `watch-search.service.ts`, the stored score
 * breakdown in `search-trace.service.ts`, and the operator dashboard in
 * `app/dashboard/ops-data.ts`. When the copies drift, a trace records a
 * different availability contribution than live ranking applied, and the stored
 * components stop summing to the stored total.
 *
 * A container offers browsing, not direct playback, so it scores with the
 * subtitle tier rather than above it. Zero would leave containers below
 * `passesMinimumConfidence` in the metadata and semantic lanes.
 *
 * The parameter is widened to `string` because the dashboard reads persisted
 * JSON, where an unrecognized or absent kind must score 0 rather than throw.
 */
export function availabilityScoreForKind(
  kind: WatchSearchAvailabilityKind | string | null | undefined,
): number {
  if (kind === "target_audio") return 0.25
  if (kind === "target_subtitle") return 0.18
  if (kind === "container") return 0.18
  if (kind === "related_language") return 0.08
  return 0
}
