/**
 * Expected-divergence allow-list for the parity differ.
 *
 * Entries name divergences that are by-design — admin and Strapi
 * intentionally differ on these fields, so the differ should NOT flag
 * them as drift. Each entry carries:
 *
 * - `path`: the JSON Pointer (RFC6901) of the diff entry to filter
 * - `channel`: which diff class the entry applies to
 * - `rationale`: WHY this divergence is expected; should reference a
 *   decision document under docs/solutions/ or the upstream brief
 *
 * The runtime check is a simple substring/exact match. Entries that
 * apply to multiple paths (e.g., every `ogImage.*` field) need an entry
 * per path — this keeps each suppression auditable.
 *
 * Seeded from `docs/solutions/cms/admin-app-data-model-decisions.md`
 * and the U4 plan's known divergences.
 */

export type AllowListChannel = "structural" | "value" | "order" | "semantic"

export type AllowListEntry = {
  /** RFC6901 JSON Pointer the entry applies to. */
  readonly path: string
  /** Diff channel this entry suppresses on. */
  readonly channel: AllowListChannel
  /** Why this divergence is expected. NEVER an empty string. */
  readonly rationale: string
}

export type AppliedAllowListEntry = {
  readonly path: string
  readonly channel: AllowListChannel
  readonly rationale: string
}

/**
 * Default seed allow-list. Captures the known intentional divergences
 * between Strapi and admin as of 2026-05-08. Add new entries with a
 * rationale that names the decision doc or PR introducing the divergence.
 *
 * Adding entries here without a rationale that points to a tracked
 * decision is the documented anti-pattern — see plan Risks.
 *
 * Plan-003 U8 (batch verification harness): operators pass a
 * `--allow-list <path>` JSON file to extend this default at runtime.
 * Entries added there carry the same auditing contract — every entry
 * MUST cite a decision doc in its rationale. See
 * `packages/graphql/scripts/run-batch-verification.ts` for the CLI flow
 * and `packages/graphql/src/parity/batch-verification.ts` for the file-
 * format validation.
 */
export const DEFAULT_ALLOW_LIST: ReadonlyArray<AllowListEntry> = [
  {
    path: "/ogImage/width",
    channel: "structural",
    rationale:
      "admin schema exposes ogImageUrl only; structural ogImage fields (width/height/alt) are filled with null by the admin normalizer. See docs/solutions/cms/admin-app-data-model-decisions.md.",
  },
  {
    path: "/ogImage/height",
    channel: "structural",
    rationale:
      "admin schema exposes ogImageUrl only; structural ogImage fields (width/height/alt) are filled with null by the admin normalizer. See docs/solutions/cms/admin-app-data-model-decisions.md.",
  },
  {
    path: "/ogImage/alt",
    channel: "structural",
    rationale:
      "admin schema exposes ogImageUrl only; structural ogImage fields (width/height/alt) are filled with null by the admin normalizer. See docs/solutions/cms/admin-app-data-model-decisions.md.",
  },
  {
    path: "/id",
    channel: "value",
    rationale:
      "Top-level experience id differs by design — admin uses cuid (ExperienceLocale.id); Strapi uses documentId. Cross-side ID equality is NOT a parity check (per U5 semantic class).",
  },
]

/**
 * Lookup table indexed by path for O(1) suppression check.
 */
export function indexAllowList(
  entries: ReadonlyArray<AllowListEntry>,
): ReadonlyMap<string, AllowListEntry> {
  const map = new Map<string, AllowListEntry>()
  for (const entry of entries) {
    if (entry.rationale === "") {
      throw new Error(
        `allow-list entry at path '${entry.path}' has empty rationale`,
      )
    }
    map.set(`${entry.channel}:${entry.path}`, entry)
  }
  return map
}
