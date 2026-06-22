// Pure, React-free decision helpers for /series/[slug]. Extracted (like
// panelState.ts) so the bug-prone branches (trailer pick, leaf bounce, state
// selection) are unit-testable under jest-expo, which cannot load .tsx.

import { isSeriesRecord } from "../../lib/isSeriesRecord"
import { resolveDefaultSlug } from "../../lib/resolveDefaultLanguage"

// ── Playable trailer (R4) ──────────────────────────────────────────

/**
 * The series' own playable dub (what Play Trailer plays). Same rule as
 * pickFirstPlayableVariant: `published` AND non-empty `hls`. Null when none
 * qualifies, so the caller renders no dead action.
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

/**
 * The dub Play Trailer starts in before any selection: the default-language
 * chain (device locale → primary → English → first) over PLAYABLE dubs only
 * (resolveDefaultVariantIndex rule), not array order, which picks arbitrary languages.
 */
export function pickDefaultTrailer<
  V extends {
    published: boolean
    hls: string | null
    slug: string
    languageSlug: string | null
    languageBcp47: string | null
  },
>(
  record:
    | { variants: readonly V[]; primaryLanguageBcp47: string | null }
    | null
    | undefined,
): V | null {
  if (record == null) return null
  const playable = record.variants.filter(
    (v) => v.published === true && v.hls != null && v.hls !== "",
  )
  if (playable.length === 0) return null
  const best = resolveDefaultSlug(
    playable.map((v) => ({
      slug: v.slug,
      bcp47: v.languageBcp47,
      languageSlug: v.languageSlug,
    })),
    record.primaryLanguageBcp47,
    null,
  )
  return playable.find((v) => v.slug === best) ?? playable[0]
}

// ── Leaf bounce (R1) ───────────────────────────────────────────────

export type LeafBounceDecision = "render" | "bounce" | "pending"

/**
 * Should a /series deep-link bounce to /watch? Same isSeriesRecord predicate as the
 * watch redirect (U5), both replace, so seams can't loop. "render": series-shaped;
 * "bounce": leaf once `hasSeriesSelection` (the completeness signal that avoids ejecting a warm-cache partial reading leaf-shaped but still gaining children); else "pending".
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
 * Which of the three screen states renders. Mirrors showErrorState: error ONLY
 * when the query failed AND nothing renderable — a stale/partial record or seed
 * beats it, and a retrying query (`loading`) shows the spinner, not an error flash.
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
