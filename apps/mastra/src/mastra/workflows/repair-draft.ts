/**
 * Bounded validate→repair-with-error-feedback orchestration (consolidation U4).
 *
 * Ported from `apps/admin/src/services/experience-ai/repair-draft.ts` and
 * co-located with the `experience-reviser` agent it drives so a repair attempt
 * does not require an extra admin↔mastra round-trip. Decoupled from admin's
 * `experience-ai-normalize` module (which owns `BlocksSchema` and STAYS in
 * admin per R2/R4): instead of importing admin's `ExperienceAiNormalizationError`
 * class, this module operates on a local `NormalizationErrorLike` SHAPE
 * (`{ code, message, cause? }`). Admin serializes its typed normalize failure
 * into this shape on the wire; the contract is the closed `code` union below.
 *
 * Three pieces:
 *  1. `classifyRepairability(err)` — maps a `NormalizationErrorLike.code` to a
 *     repair class. ONLY `schema_violation` is repair-eligible;
 *     `structurally_impossible` (the model referenced/duplicated a candidate
 *     that does not exist) fails closed immediately and NEVER enters the loop.
 *  2. `serializeNormalizationError(err)` — turns the shaped error (and, for
 *     `INVALID_BLOCKS`, any underlying Zod issues on `err.cause`) into a
 *     concise, model-readable instruction string for the repair re-prompt.
 *  3. `repairDraft(...)` — builds the repair prompt (offending draft JSON +
 *     serialized errors + candidate refs), calls the repair agent via the
 *     injected `mastra.getAgentById(...).generate(...)` with a per-call timeout
 *     strictly under the caller's remaining budget, and parses the returned
 *     draft into a `DraftExperience` (or throws a typed `RepairDraftError`).
 *
 * Classification keys off the literal `.code`, never a message regex, with an
 * exhaustive `switch` + `never` over the code union so adding a new
 * normalization code is a compile-time forcing function here.
 */

import type { Mastra } from "@mastra/core"
import { z } from "zod"

import {
  coerceDraftEnvelope,
  DraftExperienceSchema,
  extractJsonObject,
  type DraftExperience,
  type VideoCandidate,
} from "@forge/experience-schema"

// ---------------------------------------------------------------------------
// Normalize-shaped error contract (admin-free)
// ---------------------------------------------------------------------------

/**
 * The closed set of admin normalization failure codes. Mirrors admin's
 * `ExperienceAiNormalizationErrorCode` union; kept local so this module never
 * imports `apps/admin`. Admin maps its typed error to this code on the wire.
 */
export type NormalizationErrorCode =
  | "INVALID_BLOCKS"
  | "BELOW_MIN_BLOCKS"
  | "UNKNOWN_VIDEO_REF"
  | "UNKNOWN_SECTION_REF"
  | "DUPLICATE_SECTION_REF"

/**
 * The structural shape `repairDraft` needs from a normalization failure — the
 * "normalize-shaped error" the consolidation plan refers to. `cause` may carry
 * a `ZodError` so `serializeNormalizationError` can surface concrete issue
 * paths.
 */
export interface NormalizationErrorLike {
  readonly code: NormalizationErrorCode
  readonly message: string
  readonly cause?: unknown
}

// ---------------------------------------------------------------------------
// Repair taxonomy
// ---------------------------------------------------------------------------

/**
 * The repair class a normalization failure maps to:
 *
 *  - `malformed_syntax` — the model output could not be parsed at all (JSON
 *    un-parseable). Reserved for the repair-OUTPUT parse path; the normalize
 *    boundary never produces it (normalize only runs on an already-parsed
 *    `DraftExperience`), but the class exists so the repair re-prompt's own
 *    parse failures classify honestly. Fail closed.
 *  - `schema_violation` — the draft parses but fails the
 *    `DraftExperienceSchema`/`BlocksSchema` shape contract (wrong
 *    discriminator, extra key, missing field, below the generation minimum).
 *    REPAIR-ELIGIBLE: re-prompting with the concrete errors can converge.
 *  - `structurally_impossible` — the model referenced (or duplicated) a
 *    candidate/section that does not exist. Re-prompting cannot invent a
 *    candidate, so this fails closed immediately and NEVER enters the loop.
 */
export type RepairClass =
  | "malformed_syntax"
  | "schema_violation"
  | "structurally_impossible"

/**
 * Classify a `NormalizationErrorLike` into a repair class by its `.code` (a
 * closed literal union). Exhaustive `switch` + `never` default so a future
 * normalization code fails to compile here until it is mapped — a new
 * structural-failure mode can never silently become repair-eligible.
 *
 * Mapping:
 *  - `INVALID_BLOCKS` / `BELOW_MIN_BLOCKS` → `schema_violation`
 *    (repair-eligible: the shape/size is wrong but the refs may be sound).
 *  - `UNKNOWN_VIDEO_REF` / `UNKNOWN_SECTION_REF` / `DUPLICATE_SECTION_REF`
 *    → `structurally_impossible` (the model cannot invent a candidate that
 *    doesn't exist; re-prompting would loop without converging).
 */
export function classifyRepairability(
  err: NormalizationErrorLike,
): RepairClass {
  const code: NormalizationErrorCode = err.code
  switch (code) {
    case "INVALID_BLOCKS":
    case "BELOW_MIN_BLOCKS":
      return "schema_violation"
    case "UNKNOWN_VIDEO_REF":
    case "UNKNOWN_SECTION_REF":
    case "DUPLICATE_SECTION_REF":
      return "structurally_impossible"
    default: {
      const exhaustive: never = code
      return exhaustive
    }
  }
}

/**
 * Whether a repair class is eligible to enter the bounded repair loop. ONLY
 * `schema_violation` re-prompts; the other two fail closed.
 */
export function isRepairEligible(repairClass: RepairClass): boolean {
  return repairClass === "schema_violation"
}

// ---------------------------------------------------------------------------
// Error serialization for the repair re-prompt
// ---------------------------------------------------------------------------

/**
 * The Zod issues carried on an `INVALID_BLOCKS` error, when the normalize
 * stage attaches them. `serializeNormalizationError` reads `err.cause`
 * defensively for a `ZodError`-shaped value (admin's normalize may attach the
 * issues, and `repairDraft`'s own re-validation surfaces them directly).
 */
function extractZodIssues(err: NormalizationErrorLike): string[] {
  const cause = err.cause
  if (cause instanceof z.ZodError) {
    return cause.issues.slice(0, 12).map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)"
      return `${path}: ${issue.message}`
    })
  }
  return []
}

/**
 * Turn a normalize-shaped error into a concise, model-readable instruction
 * string for the repair re-prompt. Plain text (NOT JSON) — the reviser agent
 * reads it as critique-style notes. Includes the error code, the message, and
 * (for `INVALID_BLOCKS` when available) the concrete Zod issue paths so the
 * model knows EXACTLY which block/field to fix.
 *
 * Always returns a non-empty string.
 */
export function serializeNormalizationError(
  err: NormalizationErrorLike,
): string {
  const lines: string[] = [
    `The draft you produced failed structural validation and must be corrected.`,
    `Validation error code: ${err.code}`,
    `Validation message: ${err.message}`,
  ]
  const issues = extractZodIssues(err)
  if (issues.length > 0) {
    lines.push("Specific schema problems to fix:")
    for (const issue of issues) {
      lines.push(`  - ${issue}`)
    }
  }
  lines.push(
    "Return a corrected draft in the SAME envelope shape. Keep the parts that were valid; only change what the errors call out. Do NOT invent video or section references — use only the candidate refs provided.",
  )
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Repair output parsing — reuses the shared schema package's
// `extractJsonObject` + `coerceDraftEnvelope` + `DraftExperienceSchema`. The
// chat-envelope lift mirrors the workflow's `liftToDraftExperienceShape`
// (intentionally duplicated here — small, and crossing the module boundary
// would close a require cycle).
// ---------------------------------------------------------------------------

/**
 * Lift a chat-style envelope (`{ mutations }` / `{ diff: { scalars, blocks } }`)
 * to the flat `{ title, metaDescription, blocks }` shape
 * `DraftExperienceSchema` expects. Mirror of the workflow's lifter so the
 * repair agent (the experience-reviser, whose prompt emits the diff envelope)
 * is parsed identically.
 */
function liftEnvelopeShape(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed
  const obj = parsed as Record<string, unknown>

  if (obj.mutations && typeof obj.mutations === "object") {
    return obj.mutations
  }

  if (obj.diff && typeof obj.diff === "object") {
    const diff = obj.diff as Record<string, unknown>
    const scalars = (diff.scalars ?? {}) as Record<string, unknown>
    const lifted: Record<string, unknown> = {}

    const title = scalars.title
    if (typeof title === "string") {
      lifted.title = title
    } else if (
      title &&
      typeof title === "object" &&
      "after" in (title as Record<string, unknown>)
    ) {
      lifted.title = (title as { after: unknown }).after
    }

    const meta = scalars.metaDescription
    if (typeof meta === "string") {
      lifted.metaDescription = meta
    } else if (
      meta &&
      typeof meta === "object" &&
      "after" in (meta as Record<string, unknown>)
    ) {
      lifted.metaDescription = (meta as { after: unknown }).after
    }

    if (Array.isArray(diff.blocks)) {
      lifted.blocks = diff.blocks
    }
    return lifted
  }

  return parsed
}

/**
 * Typed error thrown when the repair agent's OWN output is unusable — either
 * it didn't parse as JSON (`malformed_syntax`) or it parsed but still failed
 * `DraftExperienceSchema` (`schema_violation`), or the call aborted
 * (`timeout`). The caller treats either as a terminal failure; the loop's own
 * attempt cap governs how many repair calls are made.
 */
export class RepairDraftError extends Error {
  readonly name = "RepairDraftError"
  constructor(
    readonly reason: "malformed_syntax" | "schema_violation" | "timeout",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
  }
}

/**
 * Parse the repair agent's text reply into a `DraftExperience`, reusing the
 * same resilience the workflow uses: raw `JSON.parse` → `extractJsonObject` →
 * `jsonrepair`, then lift the chat envelope, coerce (LOSSY), and validate
 * against `DraftExperienceSchema`. Throws `RepairDraftError` when nothing
 * usable comes out.
 */
async function parseRepairOutput(text: string): Promise<DraftExperience> {
  let parsed: unknown
  let parseError: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    parseError = err
    const extracted = extractJsonObject(text)
    if (extracted !== null) {
      try {
        parsed = JSON.parse(extracted)
        parseError = null
      } catch (innerErr) {
        parseError = innerErr
        try {
          const { jsonrepair } = await import("jsonrepair")
          parsed = JSON.parse(jsonrepair(extracted))
          parseError = null
        } catch (repairErr) {
          parseError = repairErr
        }
      }
    }
  }
  if (parseError !== null) {
    throw new RepairDraftError(
      "malformed_syntax",
      "repair agent output was not valid JSON",
      parseError,
    )
  }

  const lifted = liftEnvelopeShape(parsed)
  const { draft: coerced } = coerceDraftEnvelope(lifted)
  const result = DraftExperienceSchema.safeParse(coerced)
  if (!result.success) {
    throw new RepairDraftError(
      "schema_violation",
      `repair agent output did not satisfy DraftExperienceSchema: ${result.error.message}`,
      result.error,
    )
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Repair orchestration
// ---------------------------------------------------------------------------

/**
 * The agent id used for the repair re-prompt. We REUSE the existing
 * `experience-reviser` agent rather than adding a dedicated repair agent: the
 * reviser already takes a draft + notes and re-emits the same draft envelope
 * shape, has the right tool catalog, and is memory-less (workflow-only) so a
 * repair call leaks no chat history. The repair "notes" are the serialized
 * validation errors — see `serializeNormalizationError`.
 */
export const REPAIR_AGENT_ID = "experience-reviser"

/**
 * Per-repair-call wall-clock ceiling. A single reviser re-prompt is ~15-30s;
 * this cap is strictly under the caller's remaining budget (the caller passes
 * `timeoutMs = min(REPAIR_CALL_TIMEOUT_MS, remainingBudget)` so a repair call
 * never out-races the outer timeout — cf.
 * `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`).
 */
export const REPAIR_CALL_TIMEOUT_MS = 30_000

const MAX_CANDIDATE_REFS_IN_PROMPT = 40

/**
 * Build the repair re-prompt: the serialized validation errors, the candidate
 * ref→title list (so the model cannot drift refs), and the offending draft
 * JSON. Plain text — the reviser's system prompt owns the envelope-shape rules.
 */
function buildRepairPrompt(args: {
  draft: DraftExperience
  candidates: readonly VideoCandidate[]
  errorInstruction: string
}): string {
  const candidateLines = args.candidates
    .slice(0, MAX_CANDIDATE_REFS_IN_PROMPT)
    .map((c) => `  ${c.ref} -> ${c.title}`)
    .join("\n")
  return [
    args.errorInstruction,
    "",
    "Available video candidate refs (use ONLY these; never invent a ref):",
    candidateLines || "  (none)",
    "",
    "Offending draft to correct (JSON):",
    JSON.stringify(args.draft),
  ].join("\n")
}

type RepairAgent = {
  generate: (
    prompt: string,
    opts: { abortSignal?: AbortSignal },
  ) => Promise<{ text: string; object?: unknown }>
}

type RepairMastra = {
  getAgentById: (id: string) => RepairAgent
}

/**
 * Compose the caller's abort signal with a per-call timeout. The repair call
 * aborts at whichever fires first — the outer-budget signal (passed in) or the
 * local timeout. Uses `AbortSignal.any` when available (Node 20.3+), falling
 * back to a manual relay so the function stays portable.
 */
function withRepairTimeout(
  timeoutMs: number,
  outer: AbortSignal | undefined,
): { signal: AbortSignal; cleanup: () => void } {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (outer === undefined) {
    return { signal: timeoutSignal, cleanup: () => {} }
  }
  if (typeof AbortSignal.any === "function") {
    return {
      signal: AbortSignal.any([outer, timeoutSignal]),
      cleanup: () => {},
    }
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (outer.aborted) controller.abort()
  else outer.addEventListener("abort", onAbort, { once: true })
  timeoutSignal.addEventListener("abort", onAbort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      outer.removeEventListener("abort", onAbort)
      timeoutSignal.removeEventListener("abort", onAbort)
    },
  }
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  )
}

export type RepairDraftArgs = {
  /** The `DraftExperience` that failed the normalize→BlocksSchema boundary. */
  draft: DraftExperience
  /** Candidate refs so the repair re-prompt keeps refs valid. */
  candidates: readonly VideoCandidate[]
  /** The normalize-shaped failure that triggered this repair attempt. */
  error: NormalizationErrorLike
  /** 1-based attempt number (for the structured log). */
  attempt: number
  /** The Mastra runtime — the standalone service's `mastra` at the call site. */
  mastra: Mastra
  /** The outer-budget abort signal, if any. */
  abortSignal?: AbortSignal
  /**
   * Per-call wall-clock ceiling. The caller passes the smaller of
   * `REPAIR_CALL_TIMEOUT_MS` and the remaining budget so the repair call never
   * out-races the outer timeout.
   */
  timeoutMs: number
}

/**
 * Re-prompt the repair agent once with the offending draft + concrete errors
 * and return the corrected `DraftExperience`. Throws `RepairDraftError` when
 * the repair OUTPUT is itself unusable (un-parseable or still schema-invalid)
 * or when the call times out / aborts.
 *
 * This is ONE repair call — the bounded loop (attempt cap) lives at the caller.
 */
export async function repairDraft(
  args: RepairDraftArgs,
): Promise<DraftExperience> {
  const errorInstruction = serializeNormalizationError(args.error)
  const prompt = buildRepairPrompt({
    draft: args.draft,
    candidates: args.candidates,
    errorInstruction,
  })

  const { signal, cleanup } = withRepairTimeout(
    args.timeoutMs,
    args.abortSignal,
  )
  let result: { text: string; object?: unknown }
  try {
    const agent = (args.mastra as unknown as RepairMastra).getAgentById(
      REPAIR_AGENT_ID,
    )
    result = await agent.generate(prompt, { abortSignal: signal })
  } catch (err) {
    if (isAbortError(err)) {
      throw new RepairDraftError(
        "timeout",
        "repair agent.generate aborted (timeout or outer-budget abort)",
        err,
      )
    }
    throw new RepairDraftError(
      "schema_violation",
      `repair agent.generate failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  } finally {
    cleanup()
  }

  // Prefer a provider-validated structured object; else parse the text.
  if (result.object !== undefined && typeof result.object === "object") {
    const lifted = liftEnvelopeShape(result.object)
    const { draft: coerced } = coerceDraftEnvelope(lifted)
    const parsed = DraftExperienceSchema.safeParse(coerced)
    if (parsed.success) return parsed.data
  }
  const text =
    result.text.length > 0 || result.object === undefined
      ? result.text
      : JSON.stringify(result.object)
  return parseRepairOutput(text)
}
