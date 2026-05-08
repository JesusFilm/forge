/**
 * Shared normalized route shape — both Strapi and admin normalizers
 * emit this exact type. The differ (`compare.ts`) consumes two
 * `NormalizedExperienceRoute` values and produces a `DiffReport`.
 *
 * Absent-field contract (load-bearing — see plan Key Decisions):
 * every optional field on this type carries `null` when absent on
 * the source side. Both `undefined` and missing keys map to `null`
 * in the normalizers; the differ treats `null` and missing-key as
 * equivalent post-normalization. Don't introduce optional `?:` fields
 * here without explicitly mirroring them in both normalizers AND the
 * differ's structural-class equivalence logic.
 */

import type { AdminKind, AdminOnlyKind } from "./discriminator-map"

/**
 * The full set of `kind` values a normalized block can carry — the 16
 * shared `AdminKind`s plus admin-only kinds plus synthetic markers
 * the Strapi normalizer emits while flattening container shapes
 * (`containerSlot`).
 */
export type NormalizedBlockKind = AdminKind | AdminOnlyKind | "containerSlot"

/**
 * Synthetic marker emitted by the Strapi normalizer when flattening
 * `container.slots[].content[]` into admin's flat `container.content[]`
 * shape. Preserves slot metadata (gridSpan, spans) at slot boundaries
 * so the differ can compare slot-bounded layouts faithfully.
 */
export type ContainerSlotMarker = {
  readonly kind: "containerSlot"
  readonly id: string
  readonly gridSpan: number | null
  readonly spans: ReadonlyArray<number> | null
}

/**
 * A normalized block. The `data` field carries kind-specific payload
 * as a structurally-comparable JSON value. Concrete shapes per kind
 * are validated by the per-normalizer pipeline; the differ inspects
 * `data` field-by-field via JSON Pointer paths.
 */
export type NormalizedBlock =
  | ContainerSlotMarker
  | {
      readonly kind: Exclude<NormalizedBlockKind, "containerSlot">
      readonly id: string
      readonly data: Readonly<Record<string, unknown>>
    }

/**
 * Open-graph image. Both normalizers emit this shape; admin fills
 * `width`, `height`, and `alt` with `null` since admin currently
 * exposes only `ogImageUrl: String` on `ExperienceLocale`.
 */
export type NormalizedOgImage = {
  readonly url: string
  readonly width: number | null
  readonly height: number | null
  readonly alt: string | null
}

/**
 * Per-source metadata carried alongside the normalized payload. Used by
 * the differ for class downgrades and audit trails.
 */
export type NormalizedMeta = {
  readonly source: "strapi" | "admin"
  /**
   * `true` when there's evidence the source returned fewer rows than
   * exist (Strapi pagination cap, live-mode `pagination.total >
   * returned.length`). The differ reclassifies missing-tail entries
   * out of the structural class into a `potentiallyTruncated` channel
   * for the affected side.
   *
   * Length-based heuristics (e.g., "blocks array is exactly 10") are
   * NOT a trigger — they conflate cap-truncated responses with
   * legitimate cap-sized collections. See plan Key Decisions.
   */
  readonly potentiallyTruncated: boolean
  /**
   * Map of canonical URL → raw URL captured at canonicalization time.
   * The differ consults this when emitting URL-canonicalization
   * residual entries so reviewers see what each side actually returned.
   */
  readonly rawUrls: Readonly<Record<string, string>>
}

/**
 * The shape both normalizers emit and the differ compares.
 *
 * Field-level JSDoc on every optional field documents the
 * null-on-absence contract — readers should not assume `?:` semantics.
 */
export type NormalizedExperienceRoute = {
  /** Stable identifier within the source schema. NOT compared cross-side. */
  readonly id: string
  /** Slug used to retrieve. Must match across sides for the same logical route. */
  readonly slug: string
  /**
   * Resolved locale — the locale the source actually returned. Compared
   * against URL locale and against the other side's locale for
   * semantic-class equality.
   */
  readonly locale: string
  /** Title of the experience locale. */
  readonly title: string
  /** Description; `null` when absent on the source. */
  readonly description: string | null
  /** OG image; `null` when absent on the source. */
  readonly ogImage: NormalizedOgImage | null
  /** Ordered list of normalized blocks. Empty array when no blocks present. */
  readonly blocks: ReadonlyArray<NormalizedBlock>
  /** Per-source metadata; not compared cross-side. */
  readonly meta: NormalizedMeta
}
