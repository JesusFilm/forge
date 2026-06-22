/**
 * Bounded validate→repair-with-error-feedback orchestration (U5).
 *
 * The fail-closed guarantee wraps the NORMALIZE→`BlocksSchema` boundary
 * AFTER a successful workflow run. The workflow produces a
 * `DraftExperience`; the action normalizes + validates it; if that throws a
 * REPAIR-ELIGIBLE failure, the action re-prompts a SINGLE agent (NOT a
 * workflow re-run) with the offending draft + the concrete errors, gets a
 * corrected `DraftExperience`, and re-normalizes. Attempts are capped.
 *
 * This module owns three pieces:
 *  1. `classifyRepairability(err)` — maps a typed
 *     `ExperienceAiNormalizationError.code` to a repair class. ONLY
 *     `schema_violation` is repair-eligible; `structurally_impossible`
 *     (the model referenced/duplicated a candidate that does not exist)
 *     fails closed immediately and NEVER enters the loop.
 *  2. `serializeNormalizationError(err)` — turns the typed error (and, for
 *     `INVALID_BLOCKS`, the underlying Zod issues when available) into a
 *     concise, model-readable instruction string for the repair re-prompt.
 *  3. `repairDraft(...)` — builds the repair prompt (offending draft JSON +
 *     serialized errors + the candidate list so refs stay valid), calls the
 *     repair agent via `getMastra().getAgentById(...).generate(...)` with a
 *     per-call timeout strictly under the remaining action budget, and
 *     parses the returned draft into a `DraftExperience` (or throws a typed
 *     `RepairDraftError` when the repair output is itself unusable).
 *
 * Classification keys off `instanceof` + `.code`, never a message regex,
 * with an exhaustive `switch` + `never` over the code union so adding a new
 * normalization code is a compile-time forcing function here.
 */

import type { Mastra } from "@mastra/core"
import { z } from "zod"

import { ExperienceAiNormalizationError } from "./experience-ai-normalize"
import type { ExperienceAiNormalizationErrorCode } from "./experience-ai-normalize"
import {
  coerceDraftEnvelope,
  DraftExperienceSchema,
  extractJsonObject,
  type DraftExperience,
  type VideoCandidate,
} from "@forge/experience-schema"

// ---------------------------------------------------------------------------
// Repair taxonomy
// ---------------------------------------------------------------------------

/**
 * The repair class a normalization failure maps to:
 *
 *  - `malformed_syntax` — the model output could not be parsed at all (JSON
 *    un-parseable). Reserved for the repair-OUTPUT parse path; the
 *    normalize boundary never produces it (normalize only runs on an
 *    already-parsed `DraftExperience`), but the class exists so the repair
 *    re-prompt's own parse failures classify honestly. Fail closed.
 *  - `schema_violation` — the draft parses but fails the
 *    `DraftExperienceSchema`/`BlocksSchema` shape contract (wrong
 *    discriminator, extra key, missing field, below the generation
 *    minimum). REPAIR-ELIGIBLE: re-prompting with the concrete errors can
 *    converge.
 *  - `structurally_impossible` — the model referenced (or duplicated) a
 *    candidate/section that does not exist. Re-prompting cannot invent a
 *    candidate, so this fails closed immediately and NEVER enters the loop.
 */
export type RepairClass =
  | "malformed_syntax"
  | "schema_violation"
  | "structurally_impossible"

/**
 * Classify an `ExperienceAiNormalizationError` into a repair class by its
 * `.code` (a closed literal union). Exhaustive `switch` + `never` default
 * so a future normalization code fails to compile here until it is mapped —
 * a new structural-failure mode can never silently become repair-eligible.
 *
 * Mapping (per the U5 error-class table):
 *  - `INVALID_BLOCKS` / `BELOW_MIN_BLOCKS` → `schema_violation`
 *    (repair-eligible: the shape/size is wrong but the refs may be sound).
 *  - `UNKNOWN_VIDEO_REF` / `UNKNOWN_SECTION_REF` / `DUPLICATE_SECTION_REF`
 *    → `structurally_impossible` (the model cannot invent a candidate that
 *    doesn't exist; re-prompting would loop without converging).
 */
export function classifyRepairability(
  err: ExperienceAiNormalizationError,
): RepairClass {
  const code: ExperienceAiNormalizationErrorCode = err.code
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
 * Whether a repair class is eligible to enter the bounded repair loop.
 * ONLY `schema_violation` re-prompts; the other two fail closed.
 */
export function isRepairEligible(repairClass: RepairClass): boolean {
  return repairClass === "schema_violation"
}

// ---------------------------------------------------------------------------
// Error serialization for the repair re-prompt
// ---------------------------------------------------------------------------

/**
 * The Zod issues carried on an `INVALID_BLOCKS` error, when the normalize
 * stage attaches them. The current normalize stage throws a bare typed
 * error (no issues attached), but `repairDraft`'s own re-validation surfaces
 * the issues directly, and a future normalize change may attach them — so
 * `serializeNormalizationError` reads `err.cause` defensively for a
 * `ZodError`-shaped value.
 */
function extractZodIssues(err: ExperienceAiNormalizationError): string[] {
  const cause = (err as { cause?: unknown }).cause
  if (cause instanceof z.ZodError) {
    return cause.issues.slice(0, 12).map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)"
      return `${path}: ${issue.message}`
    })
  }
  return []
}

/**
 * Turn a typed normalization error into a concise, model-readable
 * instruction string for the repair re-prompt. Plain text (NOT JSON) — the
 * reviser agent reads it as critique-style notes. Includes the error code,
 * the message, and (for `INVALID_BLOCKS` when available) the concrete Zod
 * issue paths so the model knows EXACTLY which block/field to fix.
 *
 * Always returns a non-empty string.
 */
export function serializeNormalizationError(
  err: ExperienceAiNormalizationError,
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
// Repair output parsing — self-contained (no mastra/workflows import to
// avoid a require cycle: this module lives in services/experience-ai, and
// the workflow imports FROM services/experience-ai). Reuses the co-located
// `extractJsonObject` + `coerceDraftEnvelope` + `DraftExperienceSchema`.
// The chat-envelope lift mirrors the workflow's `liftToDraftExperienceShape`
// (intentionally duplicated here — small, and crossing the module boundary
// would close the cycle).
// ---------------------------------------------------------------------------

/**
 * Lift a chat-style envelope (`{ mutations }` / `{ diff: { scalars,
 * blocks } }`) to the flat `{ title, metaDescription, blocks }` shape
 * `DraftExperienceSchema` expects. Mirror of the workflow's lifter so the
 * repair agent (the experience-reviser, whose prompt emits the diff
 * envelope) is parsed identically.
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
 * Typed error thrown when the repair agent's OWN output is unusable —
 * either it didn't parse as JSON (`malformed_syntax`) or it parsed but
 * still failed `DraftExperienceSchema` (`schema_violation`). The action
 * treats either as a terminal failure (it does not enter the next loop
 * iteration with a draft that never materialized); the loop's own attempt
 * cap governs how many repair calls are made.
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
 * same resilience the workflow uses: raw `JSON.parse` → `extractJsonObject`
 * → `jsonrepair`, then lift the chat envelope, coerce (LOSSY), and validate
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
 * `experience-reviser` agent rather than adding a dedicated repair agent:
 * the reviser already takes a draft + notes and re-emits the same draft
 * envelope shape, has the right tool catalog (searchVideos / lookupBibleVerse
 * / fetchVideoImage), and is memory-less (workflow-only) so a repair call
 * leaks no chat history. The repair "notes" are the serialized validation
 * errors — see `serializeNormalizationError`.
 */
export const REPAIR_AGENT_ID = "experience-reviser"

/**
 * Per-repair-call wall-clock ceiling. A single reviser re-prompt is ~15-30s;
 * this cap is strictly under the action's remaining budget (the caller passes
 * `timeoutMs = min(REPAIR_CALL_TIMEOUT_MS, remainingBudget)` so a repair call
 * never out-races the outer action timeout — cf.
 * `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`).
 */
export const REPAIR_CALL_TIMEOUT_MS = 30_000

const MAX_CANDIDATE_REFS_IN_PROMPT = 40

/**
 * Build the repair re-prompt: the serialized validation errors, the
 * offending draft JSON, and the candidate ref→title list so the model
 * cannot drift refs. Plain text — the reviser's system prompt owns the
 * envelope-shape rules.
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
 * Compose the caller's abort signal with a per-call timeout. The repair
 * call aborts at whichever fires first — the action-budget signal (passed
 * in) or the local timeout. Uses `AbortSignal.any` when available
 * (Node 20.3+), falling back to a manual relay so the function stays
 * portable.
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
  /** The typed normalization failure that triggered this repair attempt. */
  error: ExperienceAiNormalizationError
  /** 1-based attempt number (for the structured log). */
  attempt: number
  /** The Mastra runtime — `getMastra()` at the call site. */
  mastra: Mastra
  /** The outer action-budget abort signal, if any. */
  abortSignal?: AbortSignal
  /**
   * Per-call wall-clock ceiling. The caller passes the smaller of
   * `REPAIR_CALL_TIMEOUT_MS` and the remaining action budget so the repair
   * call never out-races the outer action timeout.
   */
  timeoutMs: number
}

/**
 * Re-prompt the repair agent once with the offending draft + concrete
 * errors and return the corrected `DraftExperience`. Throws
 * `RepairDraftError` when the repair OUTPUT is itself unusable (un-parseable
 * or still schema-invalid) or when the call times out / aborts.
 *
 * This is ONE repair call — the bounded loop (attempt cap) lives at the
 * action layer.
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
