/**
 * Data shapes for the public status dashboard pipeline.
 *
 *   prod DB ──(dashboard:data)──▶ prod-status-data.json
 *   prod-status-data.json + docs/source-status.yaml + registry
 *           ──(dashboard:build)──▶ compiled-data.json ──▶ dashboard/index.html
 *
 * Two flag families, kept deliberately distinct:
 *   - acquire / ingest come from the PROD database (verified inventory).
 *   - evaluate is a DECISION: true only when prod has acquired AND ingested the
 *     row AND the engineer marked `stages.evaluate: green` in
 *     docs/source-status.yaml (the shipped-via-PR signal that source-quality
 *     evaluation actually happened). The prod eval script is a non-gating
 *     sanity check and is intentionally NOT consulted here.
 */
import { z } from "zod"

/** One ingested (source × language) row as observed in the prod DB. */
export const prodIngestedRowSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9/-]{0,99}$/),
    name: z.string().min(1).max(200),
    host: z
      .string()
      .regex(/^[a-z0-9.-]+$/i)
      .max(253)
      .nullable(),
    language: z.string().regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i),
    embedded_doc_count: z.number().int().nonnegative(),
  })
  .strict()
export type ProdIngestedRow = z.infer<typeof prodIngestedRowSchema>

/** One source's tally of embedded documents with NO detected language
 *  (`documents.language IS NULL`). These are in the index and retrievable —
 *  just unattributed to a language — so they are surfaced separately rather
 *  than dropped, which would silently under-report the index (#86). Only
 *  sources with at least one such document appear. */
export const prodUnclassifiedRowSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9/-]{0,99}$/),
    name: z.string().min(1).max(200),
    host: z
      .string()
      .regex(/^[a-z0-9.-]+$/i)
      .max(253)
      .nullable(),
    embedded_doc_count: z.number().int().positive(), // > 0: only listed when non-empty
  })
  .strict()
export type ProdUnclassifiedRow = z.infer<typeof prodUnclassifiedRowSchema>

/** The raw DB read result — exactly what `fetchProdStatus`/`shapeProdStatus`
 *  produce, with no timestamp (those are pure data-shaping). */
export const prodReadSchema = z
  .object({
    ingested: z.array(prodIngestedRowSchema),
    // Every source key present in raw_documents (the acquisition signal). A key
    // here means "raw documents captured" — acquire is true for every canonical
    // (source × language) row whose key appears in this set.
    acquired_keys: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9/-]{0,99}$/))
      .max(1000),
    // Per-source tally of embedded docs with no detected language (#86).
    // Optional + default `[]` so exports written before this field still parse.
    unclassified: z.array(prodUnclassifiedRowSchema).default([]),
  })
  .strict()
export type ProdRead = z.infer<typeof prodReadSchema>

/**
 * The raw prod export written by `pnpm dashboard:data`: the DB read plus
 * `fetched_at`, the date the prod read actually happened. `fetched_at` is the
 * SINGLE source of the published "Updated" label and of compiled-data.json's
 * `generated_at`, so `dashboard:build` is a pure function of its committed/local
 * inputs — rebuilding the same export reproduces byte-identical artifacts (no
 * hidden build-time clock). See docs/ops/dashboard.md.
 */
export const prodStatusDataSchema = prodReadSchema
  .extend({
    schema_version: z.literal(1),
    target: z.literal("production-read"),
    fetched_at: z.string().datetime({ offset: true }),
    source_commit: z.string().regex(/^[0-9a-f]{40}$/),
    schema_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict()
export type ProdStatusData = z.infer<typeof prodStatusDataSchema>

/** One compiled dashboard row — exactly one source × language combination. */
export const compiledRowSchema = z
  .object({
    source: z.string().min(1), // display name
    key: z.string().min(1), // canonical key (stable join id / sort)
    host: z.string().nullable(), // bare host URL, or null when unknown
    language: z.string().min(1), // language code
    acquire: z.boolean(),
    ingest: z.boolean(),
    evaluate: z.boolean(),
    embedded_doc_count: z.number().int().nonnegative(),
    // Honest enrichment from docs/source-status.yaml so a blocked/deferred row
    // is never silently shown as merely "not yet done".
    row_status: z.enum([
      "in-progress",
      "blocked",
      "done",
      "deferred",
      "unknown",
    ]),
    note: z.string().nullable(),
  })
  .strict()
export type CompiledRow = z.infer<typeof compiledRowSchema>

/** One compiled "unclassified documents" row — a source with embedded docs that
 *  have no detected language. No lifecycle flags/stage: it is a count, not a
 *  (source × language) coverage cell (#86). */
export const compiledUnclassifiedRowSchema = z
  .object({
    source: z.string().min(1), // display name
    key: z.string().min(1), // canonical key (stable join id / sort)
    host: z.string().nullable(), // bare host URL, or null when unknown
    embedded_doc_count: z.number().int().positive(),
  })
  .strict()
export type CompiledUnclassifiedRow = z.infer<
  typeof compiledUnclassifiedRowSchema
>

// ── Source map (docs/source-map.yaml, issue #100) ────────────────────────────
// Hand-curated companion to the /slice-maintained source-status.yaml: per-source
// gap notes + pending (not-yet-pipeline) language chips for sources already on
// the dashboard, and the documented-only sources (proposed / retired) known from
// the jesusfilm-ai registry but never acquired here.

/** A chip for work that exists only as knowledge — a blocked sibling domain, a
 *  planned language group — attached to a pipeline source's row. */
export const sourceMapPendingChipSchema = z
  .object({
    label: z.string().min(1), // language code or short group label ("51 sibling domains")
    state: z.enum(["blocked", "proposed"]),
    detail: z.string().nullable().default(null), // short annotation ("~2.9k")
  })
  .strict()

export const sourceMapGapSchema = z
  .object({
    host: z.string().nullable().default(null), // display host fallback (registry/prod may have none)
    missing: z.string().nullable().default(null), // the "Missing / next step" column text
    pending: z.array(sourceMapPendingChipSchema).default([]),
  })
  .strict()

/** A source we know about (jfa registry) but have never acquired: proposed for
 *  future ingestion, or deliberately retired. */
export const sourceMapDocumentedSchema = z
  .object({
    name: z.string().min(1),
    host: z.string().nullable().default(null),
    state: z.enum(["proposed", "retired"]),
    method: z.string().min(1), // plain scrape | render scrape | api | manual
    languages: z.string().min(1), // display label ("en", "en es fr pt", "50+ langs")
    est_size: z.string().min(1), // display label ("~120", "1.5k–100k+", "14 files")
    note: z.string().min(1),
  })
  .strict()

export const sourceMapSchema = z
  .object({
    gaps: z.record(z.string(), sourceMapGapSchema).default({}),
    documented: z.record(z.string(), sourceMapDocumentedSchema).default({}),
  })
  .strict()
/** Input shape (defaults not yet applied) — what the YAML file/tests provide. */
export type SourceMap = z.input<typeof sourceMapSchema>
export type ParsedSourceMap = z.infer<typeof sourceMapSchema>

// ── Compiled ledger shapes (issue #100) ──────────────────────────────────────

/** One language chip inside a source row: label + count, nothing else. State is
 *  the furthest stage that language reached (or blocked/proposed for pending). */
export const compiledChipSchema = z
  .object({
    label: z.string().min(1),
    language: z.string().nullable(), // real language code for pipeline cells; null for pending chips
    state: z.enum(["evaluated", "ingested", "acquired", "blocked", "proposed"]),
    embedded_doc_count: z.number().int().nonnegative().nullable(), // null unless ingested
    detail: z.string().nullable(),
  })
  .strict()
export type CompiledChip = z.infer<typeof compiledChipSchema>

/** One ledger row — exactly one SOURCE, its languages folded into chips. */
export const compiledSourceRowSchema = z
  .object({
    source: z.string().min(1),
    key: z.string().min(1),
    host: z.string().nullable(),
    state: z.enum([
      "evaluated",
      "ingested",
      "acquired",
      "blocked",
      "not-started",
    ]),
    group: z.enum(["production", "blocked", "pipeline"]),
    languages: z.array(compiledChipSchema),
    // All embedded documents for this source, including null-language rows.
    // The separate unclassified table is a diagnostic subset, not an addend.
    docs_in_prod: z.number().int().nonnegative(),
    missing: z.string().nullable(),
  })
  .strict()
export type CompiledSourceRow = z.infer<typeof compiledSourceRowSchema>

/** One documented-only row: a known source that never entered the pipeline. */
export const compiledDocumentedRowSchema = z
  .object({
    source: z.string().min(1),
    key: z.string().min(1),
    host: z.string().nullable(),
    state: z.enum(["proposed", "retired"]),
    method: z.string().min(1),
    languages: z.string().min(1),
    est_size: z.string().min(1),
    note: z.string().min(1),
  })
  .strict()
export type CompiledDocumentedRow = z.infer<typeof compiledDocumentedRowSchema>

/** The curated data source that feeds the HTML (committed; the CI merge gate
 *  asserts the compiled HTML contains every row below). */
export const compiledDataSchema = z
  .object({
    schema_version: z.literal(1),
    provenance: z
      .object({
        target: z.literal("production-read"),
        fetched_at: z.string().datetime({ offset: true }),
        source_commit: z.string().regex(/^[0-9a-f]{40}$/),
        schema_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict(),
    sources: z.array(compiledRowSchema),
    // The rendered ledger: one row per source with language chips, plus the
    // documented-only (proposed/retired) sources (#100). Default `[]` so
    // compiled artifacts written before these fields still parse.
    source_rows: z.array(compiledSourceRowSchema).default([]),
    documented: z.array(compiledDocumentedRowSchema).default([]),
    // Sources with embedded docs that have no detected language (#86). Optional
    // + default `[]` so compiled artifacts written before this field still parse.
    unclassified: z.array(compiledUnclassifiedRowSchema).default([]),
  })
  .strict()
export type CompiledData = z.infer<typeof compiledDataSchema>

/** Minimal registry projection the compile step needs (decoupled from the full
 *  SourceEntry so the pure builder stays trivially testable). */
export interface RegistrySource {
  key: string
  name: string
  domain: string
  languages: string[]
}

/** Minimal yaml projection: per source key, its display name, row status, and
 *  per-language evaluate stage + optional note. */
export interface YamlLanguage {
  evaluateGreen: boolean
  status: string
  note: string | null
}
export interface YamlSource {
  name: string
  status: string
  languages: Record<string, YamlLanguage>
}
export type YamlSources = Record<string, YamlSource>
