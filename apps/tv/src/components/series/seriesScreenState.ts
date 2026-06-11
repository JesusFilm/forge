// Pure, React-free decision helpers for the /series/[slug] screen. Extracted
// (like panelState.ts / detailsHelpers.ts) so the bug-prone branches — trailer
// pick, leaf bounce, state selection — are unit-testable under jest-expo,
// which cannot load .tsx.

import { isSeriesRecord } from "../../lib/isSeriesRecord"

// ── Playable trailer (R4) ──────────────────────────────────────────

/**
 * The series' own playable dub — what Play Trailer plays. Same rule as
 * normalizeVideo's pickFirstPlayableVariant: `published` AND a non-empty
 * `hls`. Null when no dub qualifies, so the caller renders no dead action.
 */
export function pickPlayableTrailer<
  V extends { published: boolean; hls: string | null },
>(record: { variants: readonly V[] } | null | undefined): V | null {
  if (record == null) return null
  return (
    record.variants.find(
      (v) => v.published === true && v.hls != null && v.hls !== "",
    ) ?? null
  )
}

// ── Leaf bounce (R1) ───────────────────────────────────────────────

export type LeafBounceDecision = "render" | "bounce" | "pending"

/**
 * Should a record deep-linked to /series bounce to /watch? Evaluates the same
 * isSeriesRecord predicate as the watch route's series redirect (U5), and both
 * sides replace — so the two seams can never disagree and loop.
 *
 * `hasSeriesSelection` is the completeness signal: whether the RAW videoBySlug
 * object carries the series-only `childDubLanguages` key — present (even as
 * []) only once the series query itself has answered. It is the one reliable
 * discriminator here: a warm partial cached by the watch screen's lean
 * fragment carries `label` and reads back with loading=false (cache-first +
 * returnPartialData), so neither a present label nor `!loading` proves the
 * record's own children have arrived — a labeled-with-children series (e.g.
 * FEATURE_FILM with 49 episodes) looks leaf-shaped on that partial, and the
 * once-guarded replace would eject it to /watch unrecoverably.
 *
 * - "render": series-shaped (label or episodes). Shape can only be gained as
 *   partial data fills in, never lost, so this wins regardless of completeness.
 * - "bounce": a non-series-shaped record once the series query has answered —
 *   only then is "no series label, no episodes" a real leaf rather than a
 *   series whose children simply haven't arrived yet.
 * - "pending": no record yet, or a watch-fragment partial that may still gain
 *   episodes (or a series label) from the in-flight series query.
 */
export function resolveLeafBounce(
  record:
    | { label: string | null; episodes?: { length: number } | null }
    | null
    | undefined,
  hasSeriesSelection: boolean,
): LeafBounceDecision {
  if (record == null) return "pending"
  if (isSeriesRecord(record)) return "render"
  return hasSeriesSelection ? "bounce" : "pending"
}

// ── Screen state (R16) ─────────────────────────────────────────────

/**
 * Which of the three screen states renders. Mirrors the watch screen's
 * showErrorState rule: error ONLY when the query failed AND nothing is
 * renderable — a stale/partial record (or a seed to paint the hero from)
 * always beats an error screen. A failed query that is already retrying
 * (`loading` again) shows the spinner, not a flash of the error state.
 */
export function resolveScreenState(input: {
  record: { documentId: string } | null
  seed?: { slug: string } | null
  error: unknown
  loading: boolean
}): "content" | "loading" | "error" {
  if (input.record != null || input.seed != null) return "content"
  if (input.error != null && !input.loading) return "error"
  return "loading"
}
