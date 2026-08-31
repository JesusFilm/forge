/**
 * The status contract — the SINGLE source of truth for the source-status
 * vocabulary, its human-facing descriptions, and the two derived views.
 *
 * Three trackers used to restate the status words independently (the
 * docs/source-status.yaml header, the /slice skill, docs/sources.md) and had
 * already drifted. This module collapses them into one definition:
 *
 *   - the deterministic writer (scripts/source-status.ts, the only sanctioned
 *     mutator) imports these enums + `deriveRowStatus` so it cannot invent or
 *     mis-assign a status;
 *   - tests/source-status.test.ts validates the COMMITTED file against the
 *     schema and the derivation (CI gate against tool bugs + stray hand-edits);
 *   - docs/sources.md keeps its richer lifecycle granularity, but only through
 *     `LifecycleLabel` (derived here), so the vocabularies can't diverge again.
 *
 * Schemas are runtime VALUES; paired types are derived via z.infer so a shape
 * changes in exactly one place. zod is external, so importing it here does not
 * violate the "contracts import nothing under src/" rule (.dependency-cruiser.cjs).
 */
import { z } from "zod"

/** The four /slice stages, in pipeline order. */
export const STAGES = ["acquire", "ingest", "retrieve", "evaluate"] as const
export type Stage = (typeof STAGES)[number]

/** Per-stage state. */
export const stageStateSchema = z.enum(["pending", "green", "red"])
export type StageState = z.infer<typeof stageStateSchema>
export const STAGE_STATE_DESCRIPTIONS: Record<StageState, string> = {
  pending: "Not started or not yet reached for this language.",
  green:
    "Complete and verified — the /slice verify gate passed for this stage.",
  red: "Attempted but failed verification (broken or blocked); needs a fix.",
}

/** Status of one language, and (derived) of a whole row. */
export const rowStatusSchema = z.enum([
  "in-progress",
  "blocked",
  "done",
  "deferred",
])
export type RowStatus = z.infer<typeof rowStatusSchema>
export const ROW_STATUS_DESCRIPTIONS: Record<RowStatus, string> = {
  "in-progress":
    "Work underway — at least one stage still pending and nothing is blocked. Used for the embedder-swap pause (with a note); reserve `deferred` for intentionally shelved work.",
  blocked:
    "Cannot proceed without an external unblock. Requires a `blocker` and a `red` stage.",
  done: "All four stages green and queryable in production.",
  deferred: "Intentionally shelved — no active work planned.",
}

/**
 * docs/sources.md lifecycle label — the furthest-progress view of a language.
 * `retrieve` has no distinct label: it collapses into `Ingested`. `Acquiring` is
 * a transient mid-crawl state sources.md sets by hand; `deriveLifecycleLabel`
 * never emits it (there is no "in progress" stage value to derive it from).
 */
export const lifecycleLabelSchema = z.enum([
  "Not started",
  "Acquiring",
  "Acquired",
  "Ingested",
  "Evaluated",
  "Blocked",
  "Deferred",
])
export type LifecycleLabel = z.infer<typeof lifecycleLabelSchema>
export const LIFECYCLE_LABEL_DESCRIPTIONS: Record<LifecycleLabel, string> = {
  "Not started": "No acquisition attempted yet (every stage pending).",
  Acquiring:
    "Crawl/extraction in progress (writing to raw_documents). A transient sources.md state — not emitted by deriveLifecycleLabel, which reads committed stage states only.",
  Acquired: "Raw documents captured; not yet ingested.",
  Ingested: "Normalized, chunked, embedded into the corpus; not yet evaluated.",
  Evaluated: "Run through the eval harness — fully live.",
  Blocked: "Acquisition/ingestion blocked — reason in the blocker/Notes.",
  Deferred: "Intentionally postponed.",
}

/** The four-stage block. */
export const stagesSchema = z
  .object({
    acquire: stageStateSchema,
    ingest: stageStateSchema,
    retrieve: stageStateSchema,
    evaluate: stageStateSchema,
  })
  .strict()
export type Stages = z.infer<typeof stagesSchema>

/** One language's record within a source row. Enforces the status↔stages invariants. */
export const languageEntrySchema = z
  .object({
    status: rowStatusSchema,
    stages: stagesSchema,
    scope: z.string().optional(), // e.g. "us-latinos (1 page)"
    blocker: z.string().optional(), // required iff status: blocked
    note: z.string().optional(), // e.g. "pending embedder-model swap"
  })
  .strict()
  .superRefine((val, ctx) => {
    // Stages advance in pipeline order: a stage may only leave `pending` once the
    // preceding stage is `green` (CodeRabbit #3 — otherwise an impossible shape like
    // ingest:pending + retrieve:green slips through and deriveLifecycleLabel under-reports).
    for (let i = 1; i < STAGES.length; i++) {
      const prev = STAGES[i - 1]
      const cur = STAGES[i]
      if (val.stages[cur] !== "pending" && val.stages[prev] !== "green") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", cur],
          message: `stage \`${cur}\` cannot be \`${val.stages[cur]}\` until \`${prev}\` is \`green\`.`,
        })
      }
    }
    if (val.status === "done") {
      for (const s of STAGES) {
        if (val.stages[s] !== "green") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["stages", s],
            message: `status \`done\` requires every stage green; \`${s}\` is \`${val.stages[s]}\`.`,
          })
        }
      }
    }
    if (val.status === "blocked") {
      if (!val.blocker || val.blocker.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blocker"],
          message: "status `blocked` requires a non-empty `blocker`.",
        })
      }
      if (!STAGES.some((s) => val.stages[s] === "red")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages"],
          message: "status `blocked` requires at least one `red` stage.",
        })
      }
    }
  })
export type LanguageEntry = z.infer<typeof languageEntrySchema>

/**
 * Top-level rollup of a row's per-language statuses.
 * Precedence (most-blocking first): blocked > in-progress > deferred > done.
 * A row is `done` only when EVERY language is `done`.
 */
export function deriveRowStatus(
  languages: Record<string, { status: RowStatus }>,
): RowStatus {
  const statuses = Object.values(languages).map((l) => l.status)
  for (const candidate of ["blocked", "in-progress", "deferred"] as const) {
    if (statuses.includes(candidate)) return candidate
  }
  return "done"
}

/** The docs/sources.md lifecycle label for a single language entry. */
export function deriveLifecycleLabel(entry: {
  status: RowStatus
  stages: Stages
}): LifecycleLabel {
  if (entry.status === "blocked") return "Blocked"
  if (entry.status === "deferred") return "Deferred"
  if (entry.stages.evaluate === "green") return "Evaluated"
  if (entry.stages.ingest === "green") return "Ingested"
  if (entry.stages.acquire === "green") return "Acquired"
  return "Not started"
}

/** A source row. The stored top-level `status` must equal the derived rollup. */
export const sourceRowSchema = z
  .object({
    name: z.string().min(1),
    status: rowStatusSchema,
    languages: z.record(z.string(), languageEntrySchema),
    slice_file: z.string().min(1),
    last_updated: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  })
  .strict()
  .superRefine((row, ctx) => {
    if (Object.keys(row.languages).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["languages"],
        message: "a source must have at least one language.",
      })
      return
    }
    const derived = deriveRowStatus(row.languages)
    if (row.status !== derived) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: `stored status \`${row.status}\` disagrees with the derived rollup \`${derived}\` — let the tool derive it.`,
      })
    }
  })
export type SourceRow = z.infer<typeof sourceRowSchema>

/** The whole docs/source-status.yaml document. */
export const sourceStatusFileSchema = z
  .object({
    sources: z.record(z.string(), sourceRowSchema),
  })
  .strict()
export type SourceStatusFile = z.infer<typeof sourceStatusFileSchema>
