/**
 * Deterministic, pure, LOSSY pre-validation coercion for AI draft
 * envelopes (the `{ title, metaDescription, blocks }` DraftExperience
 * shape — NOT the persisted `BlocksSchema`).
 *
 * This runs BEFORE `DraftExperienceSchema.safeParse` and BEFORE any
 * model round-trip. It fixes the cheapest, intent-preserving drifts so
 * the (U5) repair loop fires less often:
 *
 *  - Normalizes the block `t` discriminator: trims + case-folds, then
 *    rewrites to the canonical literal when the match is UNAMBIGUOUS in
 *    the block's scope (e.g. `"Section"` → `"section"`, `"VIDEO"` →
 *    `"video"`).
 *  - Strips unknown/extra keys that the target variant's `.strict()`
 *    shape would reject.
 *  - Drops blocks whose `t` is not a known variant in the applicable
 *    scope, or that violate a scoped-nesting rule (e.g. a `section`
 *    nested where the scope union forbids it). Recurses into
 *    `section.content` and `container.slots[].content`.
 *  - Fills known SAFE defaults that mirror the normalize stage
 *    (`HERO_DEFAULTS` videoHero clip window; `SLOT_SPAN_DEFAULTS`
 *    balanced container slot spans) — only when the field is absent and
 *    a documented default exists.
 *
 * It is LOSSY by design and SAYS SO: every mutation is appended to the
 * returned `coercions` list. It is IDEMPOTENT: an already-valid input
 * returns unchanged with an empty `coercions` list. When in doubt it
 * DROPS + logs rather than guessing — coercion must never turn a
 * semantically-different valid draft into a different one.
 *
 * The scope tables (allowed `t` literals + per-variant key allowlist)
 * are DERIVED at module load from the Draft scope unions in
 * `experience-ai.schemas.ts` via Zod `.shape`, so a schema change there
 * propagates here with zero hand-transcription drift.
 */

import { z } from "zod"

import {
  DraftBlockSchema,
  DraftContainerContentBlockSchema,
  DraftSectionContentBlockSchema,
} from "./experience-ai.schemas"

// ---------------------------------------------------------------------------
// Coercion kinds — stable identifiers surfaced into structured logs
// ---------------------------------------------------------------------------

export type CoercionKind =
  | "discriminator_normalized"
  | "unknown_key_stripped"
  | "unknown_block_dropped"
  | "misscoped_block_dropped"
  | "non_object_block_dropped"
  | "default_filled"

export type Coercion = {
  /** Stable kind identifier for log/event grouping. */
  readonly kind: CoercionKind
  /** Human-readable detail (NOT logged as JSON — see callers). */
  readonly detail: string
}

export type CoerceDraftResult = {
  /**
   * The coerced candidate object. Returned as `unknown` because
   * coercion runs BEFORE `DraftExperienceSchema.safeParse`; the caller
   * validates. Coercion only reshapes/strips/drops — it never asserts
   * the result is valid.
   */
  readonly draft: unknown
  /** Ordered list of every mutation applied. Empty == idempotent pass. */
  readonly coercions: readonly Coercion[]
}

// ---------------------------------------------------------------------------
// Scope = which block variants are legal at a given nesting position
// ---------------------------------------------------------------------------

type Scope = "top" | "section" | "container"

type VariantShape = {
  /** Canonical `t` literal, e.g. "videoHero". */
  readonly literal: string
  /** All keys the variant's `.strict()` shape permits (incl. `t`). */
  readonly keys: ReadonlySet<string>
}

/**
 * Build the per-scope variant table from a discriminated-union schema.
 * Each member is a `z.object(...).strict()`, so `.shape` is the literal
 * key set and `.shape.t.value` is the canonical discriminator.
 */
function buildVariantTable(
  union: z.ZodDiscriminatedUnion,
): Map<string, VariantShape> {
  const table = new Map<string, VariantShape>()
  for (const member of union.options) {
    // Each option is a strict ZodObject with a `t` literal.
    const shape = (member as z.ZodObject).shape as Record<string, unknown>
    const tLiteral = shape.t as z.ZodLiteral<string>
    const literal = tLiteral.value
    table.set(literal, {
      literal,
      keys: new Set(Object.keys(shape)),
    })
  }
  return table
}

const SCOPE_TABLES: Record<Scope, Map<string, VariantShape>> = {
  top: buildVariantTable(DraftBlockSchema),
  section: buildVariantTable(DraftSectionContentBlockSchema),
  container: buildVariantTable(DraftContainerContentBlockSchema),
}

/**
 * Case-insensitive lookup index per scope: lowercased literal →
 * canonical literal. Used to resolve a trimmed/case-folded incoming
 * `t` to its canonical form UNAMBIGUOUSLY. Because the underlying
 * literals are already case-unique (no two differ only by case), a
 * lowercase key maps to exactly one canonical literal — so a fold match
 * is never ambiguous.
 */
const SCOPE_FOLD_INDEX: Record<Scope, Map<string, string>> = {
  top: buildFoldIndex(SCOPE_TABLES.top),
  section: buildFoldIndex(SCOPE_TABLES.section),
  container: buildFoldIndex(SCOPE_TABLES.container),
}

function buildFoldIndex(table: Map<string, VariantShape>): Map<string, string> {
  const index = new Map<string, string>()
  for (const literal of table.keys()) {
    index.set(literal.toLowerCase(), literal)
  }
  return index
}

// ---------------------------------------------------------------------------
// Safe default mirrors (documented in experience-ai-normalize.ts)
// ---------------------------------------------------------------------------

/** videoHero clip window — mirrors normalize HERO_DEFAULTS. */
const HERO_CLIP_DEFAULTS = {
  clipStartSeconds: 0,
  clipEndSeconds: 8,
} as const

/**
 * Container balanced slot spans by slot count — mirrors normalize
 * SLOT_SPAN_DEFAULTS. `undefined` (slot count 1) means "no documented
 * default" so nothing is filled.
 */
const SLOT_SPAN_DEFAULTS: Record<number, { md: number } | undefined> = {
  1: undefined,
  2: { md: 6 },
  3: { md: 4 },
  4: { md: 3 },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Block coercion — recursive, scope-aware
// ---------------------------------------------------------------------------

type Sink = Coercion[]

/**
 * Coerce a single block at a given scope. Returns the coerced block, or
 * `null` if the block must be dropped. Every mutation is pushed to
 * `sink`. `path` is a human-readable breadcrumb for log detail only.
 */
function coerceBlock(
  raw: unknown,
  scope: Scope,
  path: string,
  sink: Sink,
): Record<string, unknown> | null {
  if (!isPlainObject(raw)) {
    sink.push({
      kind: "non_object_block_dropped",
      detail: `dropped non-object block at ${path}`,
    })
    return null
  }

  const table = SCOPE_TABLES[scope]
  const foldIndex = SCOPE_FOLD_INDEX[scope]

  // --- Discriminator normalization -------------------------------------
  const rawT = raw.t
  if (typeof rawT !== "string") {
    sink.push({
      kind: "unknown_block_dropped",
      detail: `dropped block with non-string t at ${path}`,
    })
    return null
  }

  const trimmed = rawT.trim()
  let canonical: string | undefined
  if (table.has(trimmed)) {
    // Already canonical for this scope.
    canonical = trimmed
  } else {
    const folded = foldIndex.get(trimmed.toLowerCase())
    if (folded !== undefined) {
      canonical = folded
    }
  }

  if (canonical === undefined) {
    // `t` is not a known variant in THIS scope. It may be a real block
    // type that simply isn't allowed here (mis-scoped, e.g. a `section`
    // inside a container slot) or an entirely unknown type. Distinguish
    // for the log, but the action is the same: drop.
    const knownSomewhere =
      SCOPE_TABLES.top.has(trimmed) ||
      SCOPE_TABLES.section.has(trimmed) ||
      SCOPE_TABLES.container.has(trimmed) ||
      SCOPE_FOLD_INDEX.top.has(trimmed.toLowerCase()) ||
      SCOPE_FOLD_INDEX.section.has(trimmed.toLowerCase()) ||
      SCOPE_FOLD_INDEX.container.has(trimmed.toLowerCase())
    if (knownSomewhere) {
      sink.push({
        kind: "misscoped_block_dropped",
        detail: `dropped block t='${trimmed}' not allowed in ${scope} scope at ${path}`,
      })
    } else {
      sink.push({
        kind: "unknown_block_dropped",
        detail: `dropped block with unknown t='${trimmed}' at ${path}`,
      })
    }
    return null
  }

  if (canonical !== rawT) {
    sink.push({
      kind: "discriminator_normalized",
      detail: `normalized t '${rawT}' -> '${canonical}' at ${path}`,
    })
  }

  const variant = table.get(canonical)
  if (variant === undefined) {
    // Unreachable — canonical came from the table — but keep the type
    // narrowing honest rather than asserting non-null.
    sink.push({
      kind: "unknown_block_dropped",
      detail: `dropped block t='${canonical}' with no variant shape at ${path}`,
    })
    return null
  }

  // --- Build the coerced block, stripping unknown keys -----------------
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === "t") {
      out.t = canonical
      continue
    }
    if (!variant.keys.has(key)) {
      sink.push({
        kind: "unknown_key_stripped",
        detail: `stripped unknown key '${key}' from t='${canonical}' at ${path}`,
      })
      continue
    }
    out[key] = value
  }

  // --- Recurse into nested scopes --------------------------------------
  if (canonical === "section" && variant.keys.has("content")) {
    out.content = coerceBlockArray(
      raw.content,
      "section",
      `${path}.content`,
      sink,
    )
  }

  if (canonical === "container" && variant.keys.has("slots")) {
    out.slots = coerceContainerSlots(raw.slots, `${path}.slots`, sink)
  }

  // --- Safe default mirrors --------------------------------------------
  applySafeDefaults(canonical, out, path, sink)

  return out
}

/**
 * Coerce an array of blocks at a scope, dropping members that
 * `coerceBlock` rejects. Non-array input yields an empty array (the
 * schema's `.default([])` would do the same downstream, but we coerce
 * here so the strip/drop accounting is complete).
 */
function coerceBlockArray(
  raw: unknown,
  scope: Scope,
  path: string,
  sink: Sink,
): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return []
  const out: Record<string, unknown>[] = []
  raw.forEach((member, index) => {
    const coerced = coerceBlock(member, scope, `${path}[${index}]`, sink)
    if (coerced !== null) out.push(coerced)
  })
  return out
}

/**
 * Coerce container slots. Each slot is `{ gridSpan?, spans?,
 * backgroundColor?, content: [...] }`; its `content` array is the
 * container scope. Slot-shape unknown-key stripping is intentionally
 * NOT performed here — the slot object itself is governed by
 * `DraftContainerSlotSchema.strict()` downstream and carries no
 * discriminator to coerce; we only recurse into its `content`.
 */
function coerceContainerSlots(
  raw: unknown,
  path: string,
  sink: Sink,
): unknown[] {
  if (!Array.isArray(raw)) return []
  return raw.map((slot, index) => {
    if (!isPlainObject(slot)) return slot
    const slotPath = `${path}[${index}]`
    const coercedContent = coerceBlockArray(
      slot.content,
      "container",
      `${slotPath}.content`,
      sink,
    )
    return { ...slot, content: coercedContent }
  })
}

/**
 * Fill documented safe defaults that mirror the normalize stage. Only
 * fills when the field is absent AND the default is intent-preserving.
 */
function applySafeDefaults(
  canonical: string,
  out: Record<string, unknown>,
  path: string,
  sink: Sink,
): void {
  if (canonical === "videoHero") {
    // Mirror HERO_DEFAULTS: only when BOTH bounds are absent (the
    // normalize stage's `fillHeroClipWindow` condition) so we never
    // partially override an editor-meaningful clip window.
    const startAbsent = out.clipStartSeconds === undefined
    const endAbsent = out.clipEndSeconds === undefined
    if (startAbsent && endAbsent) {
      out.clipStartSeconds = HERO_CLIP_DEFAULTS.clipStartSeconds
      out.clipEndSeconds = HERO_CLIP_DEFAULTS.clipEndSeconds
      sink.push({
        kind: "default_filled",
        detail: `filled videoHero clip window (clipStartSeconds=${HERO_CLIP_DEFAULTS.clipStartSeconds}, clipEndSeconds=${HERO_CLIP_DEFAULTS.clipEndSeconds}) at ${path}`,
      })
    }
  }

  if (canonical === "container" && Array.isArray(out.slots)) {
    const slots = out.slots
    const balancedSpan = SLOT_SPAN_DEFAULTS[slots.length]
    if (balancedSpan !== undefined) {
      slots.forEach((slot, index) => {
        if (isPlainObject(slot) && slot.spans === undefined) {
          slot.spans = { ...balancedSpan }
          sink.push({
            kind: "default_filled",
            detail: `filled balanced slot span (md=${balancedSpan.md}) at ${path}.slots[${index}]`,
          })
        }
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Coerce an AI draft envelope toward `DraftExperienceSchema` shape.
 *
 * @param input the lifted/parsed candidate object (`{ title,
 *   metaDescription, blocks }`-ish). May be any unknown value.
 * @returns the coerced object plus an ordered list of mutations. An
 *   already-valid input returns unchanged with `coercions: []`.
 */
export function coerceDraftEnvelope(input: unknown): CoerceDraftResult {
  const sink: Sink = []

  if (!isPlainObject(input)) {
    // Nothing actionable to coerce — hand the original value back so the
    // caller's schema validation produces the authoritative error.
    return { draft: input, coercions: [] }
  }

  const out: Record<string, unknown> = { ...input }

  if ("blocks" in input) {
    out.blocks = coerceBlockArray(input.blocks, "top", "blocks", sink)
  }

  return { draft: out, coercions: sink }
}
