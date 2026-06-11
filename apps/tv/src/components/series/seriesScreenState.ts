// Pure, React-free decision helpers for the /series/[slug] screen. Extracted
// (like panelState.ts / detailsHelpers.ts) so the bug-prone branches — trailer
// pick, leaf bounce, initial focus, state selection — are unit-testable under
// jest-expo, which cannot load .tsx.

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
 * - "render": series-shaped (label or episodes). Shape can only be gained as
 *   partial data fills in, never lost, so this wins regardless of completeness.
 * - "bounce": a leaf, decided only when the data is complete enough to carry
 *   `label` — either a (non-series) label is present, or the query finished so
 *   a null label is real. Never bounce off a partial cache read.
 * - "pending": no record yet, or a partial that may still gain its label.
 */
export function resolveLeafBounce(
  record:
    | { label: string | null; episodes?: { length: number } | null }
    | null
    | undefined,
  hasCompleteData: boolean,
): LeafBounceDecision {
  if (record == null) return "pending"
  if (isSeriesRecord(record)) return "render"
  if (record.label != null || hasCompleteData) return "bounce"
  return "pending"
}

// ── Initial focus chain ────────────────────────────────────────────

/**
 * Where initial D-pad focus should land: Play Trailer → first episode →
 * Language. The action row consumes the trailer/language branches (its first
 * pill arms a one-shot hasTVPreferredFocus); the "episodes" branch is wired
 * in U3 when the episode rail mounts.
 */
export function resolveInitialFocus(
  hasTrailer: boolean,
  hasEpisodes: boolean,
): "trailer" | "episodes" | "language" {
  if (hasTrailer) return "trailer"
  if (hasEpisodes) return "episodes"
  return "language"
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
  if (input.record != null || (input.seed ?? null) != null) return "content"
  if (input.error != null && !input.loading) return "error"
  return "loading"
}
