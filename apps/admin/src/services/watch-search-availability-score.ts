import type { WatchSearchAvailabilityKind } from "./watch-search.service"

/**
 * Ranking ORDER of a Search Watchability state, owned here beside the score
 * because both serving paths must sort identically: the PostgreSQL path in
 * `watch-search.service.ts` and the Typesense path in
 * `typesense-watch-search.service.ts`. Each keeps a thin adapter for its own
 * watchability shape; only this ladder is shared.
 *
 * A container sorts ABOVE `related_language` because a browsable target-language
 * container is a better representative of a result than a playable in a language
 * the viewer did not ask for. That is deliberately the opposite of the tier
 * RESOLUTION order, where the container tier runs last so a video's own Dub
 * always beats its descendants'. Rank answers "which is the better
 * representative"; resolution answers "what is this video's own state". Do not
 * reconcile the two.
 *
 * Widened to `string` for the same reason as the score below: persisted JSON may
 * carry an unrecognized kind, which must sort last rather than throw.
 */
export function watchabilityRankForKind(
  kind: WatchSearchAvailabilityKind | string | null | undefined,
): number {
  if (kind === "target_audio") return 0
  if (kind === "target_subtitle") return 1
  if (kind === "container") return 2
  if (kind === "related_language") return 3
  return 4
}

/**
 * Ranking contribution of a Search Watchability state, owned here because four
 * surfaces read it: live ranking in `watch-search.service.ts`, the Typesense
 * serving path in `typesense-watch-search.service.ts`, the stored score
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
