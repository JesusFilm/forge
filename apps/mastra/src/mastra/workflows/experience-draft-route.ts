/**
 * One-shot buffered draft route handler (consolidation U5).
 *
 * Bearer-gated `/forge-experience-draft` entrypoint: admin loads candidates +
 * selects the exemplar (its pgvector + embeddings), then POSTs
 * `{ prompt, locale, candidates, exemplar?, mode? }`; this handler runs the
 * `multi-step-draft` (default) or `quick-draft` workflow on the standalone
 * Mastra instance and returns ONE discriminated JSON envelope. No mastra→admin
 * callback — admin persists from the response (ABAC + ContentRevision stay
 * admin-side).
 *
 * Mirrors the embedding routes' `handle*RouteRequest` shape (bearer → parse →
 * run → envelope) and the `admin-embedding-ingest-client` discriminated
 * `{ ok } | { ok:false, reason, retryable }` envelope.
 *
 * Budget: the workflow run is wrapped in an internal `AbortSignal.timeout(
 * TIME_BUDGET_MS.multiStepWorkflow)` (best-effort `run.cancel()` on timeout so
 * the run does not keep burning LLM calls). Admin's outbound caller budget (U6)
 * MUST be strictly larger than this internal budget so the admin classifier
 * doesn't win the race and trigger a retry storm
 * (`docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`).
 *
 * Plain-string logging only (Railway logsV2 silences JSON.stringify payloads
 * from this runtime path).
 */

import { z } from "zod"

import { DraftExperienceSchema } from "@forge/experience-schema"
import type { DraftExperience } from "@forge/experience-schema"

import { TIME_BUDGET_MS } from "../budgets"
import { isValidServiceBearer } from "../../server/service-bearer"
import { WorkflowStepError } from "./multi-step-draft"

// ---------------------------------------------------------------------------
// Wire contract — request body + discriminated result envelope
// ---------------------------------------------------------------------------

// Lenient candidate shape — admin computes candidates and ships them; the
// workflow only stringifies a few fields. Pinned on `videoId` (the real
// `VideoCandidate` shape); `ref` is accepted too (the draft prompts reference
// candidates by `ref`). Passthrough so admin can add fields without a wire bump.
const candidateSchema = z
  .object({
    videoId: z.string().optional(),
    ref: z.string().optional(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    slug: z.string().optional(),
  })
  .passthrough()

/**
 * Strict request body. `mode` selects the workflow (`quick` → quick-draft,
 * anything else → multi-step-draft). Only `prompt`/`locale`/`candidates`/
 * `exemplar` are forwarded to the workflow's `inputData`.
 */
export const ExperienceDraftRequestSchema = z.object({
  prompt: z.string().min(1),
  locale: z.string().min(1).default("en"),
  candidates: z.array(candidateSchema).default([]),
  exemplar: z.string().optional(),
  mode: z.enum(["quick", "multi"]).optional(),
})
export type ExperienceDraftRequest = z.infer<
  typeof ExperienceDraftRequestSchema
>

export type ExperienceDraftFailureReason =
  | "invalid_input"
  | "timeout"
  | "generation_failed"
  | "internal_error"

/**
 * The discriminated envelope returned in the response body. Admin's U6 client
 * branches on `reason` + `retryable`; the HTTP status (see `statusForResult`)
 * is the coarse signal.
 */
export type ExperienceDraftRouteResult =
  | { ok: true; draft: DraftExperience }
  | {
      ok: false
      reason: ExperienceDraftFailureReason
      retryable: boolean
      message?: string
    }

export type ExperienceDraftRouteOutcome = {
  status: number
  body: ExperienceDraftRouteResult | { error: string }
}

// ---------------------------------------------------------------------------
// Minimal Mastra run surface (kept narrow so the handler is unit-testable
// without constructing the full Mastra instance)
// ---------------------------------------------------------------------------

type DraftWorkflowRunResult = {
  status: string
  result?: unknown
  error?: unknown
}

type DraftWorkflowRun = {
  start: (args: { inputData: unknown }) => Promise<DraftWorkflowRunResult>
  cancel?: () => Promise<void>
  runId?: string
}

type DraftWorkflow = {
  createRun: (options?: unknown) => Promise<DraftWorkflowRun> | DraftWorkflowRun
}

export type DraftWorkflowMastra = {
  getWorkflowById: (id: string) => DraftWorkflow
}

// ---------------------------------------------------------------------------
// Internal timeout
// ---------------------------------------------------------------------------

class DraftRouteTimeoutError extends Error {
  readonly name = "DraftRouteTimeoutError"
  constructor(readonly budgetMs: number) {
    super(`draft workflow exceeded ${budgetMs}ms internal budget`)
  }
}

/**
 * Race a promise against an `AbortSignal.timeout(ms)`. Rejects with a typed
 * `DraftRouteTimeoutError` when the budget fires first so the caller can
 * classify it as `timeout` (retryable) rather than a generic failure.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const signal = AbortSignal.timeout(ms)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DraftRouteTimeoutError(ms))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Workflow error classification
// ---------------------------------------------------------------------------

/**
 * Map a workflow-internal failure onto the result envelope. `WorkflowStepError`
 * carries a typed `reason` so we never regex a message:
 *   - timeout      → `timeout` (retryable)
 *   - agent_error  → `generation_failed` (retryable — transient provider error)
 *   - schema_mismatch / truncated → `generation_failed` (NOT retryable —
 *     re-prompting the same way truncates / mis-shapes again)
 * Any other error → `generation_failed` (retryable).
 */
function classifyWorkflowError(error: unknown): ExperienceDraftRouteResult {
  if (error instanceof WorkflowStepError) {
    if (error.reason === "timeout") {
      return {
        ok: false,
        reason: "timeout",
        retryable: true,
        message: error.message,
      }
    }
    const retryable = error.reason === "agent_error"
    return {
      ok: false,
      reason: "generation_failed",
      retryable,
      message: error.message,
    }
  }
  return {
    ok: false,
    reason: "generation_failed",
    retryable: true,
    message: error instanceof Error ? error.message : String(error),
  }
}

function statusForResult(result: ExperienceDraftRouteResult): number {
  if (result.ok) return 200
  switch (result.reason) {
    case "invalid_input":
      return 400
    case "timeout":
      return 504
    case "generation_failed":
      return 502
    case "internal_error":
      return 500
    default: {
      const exhaustive: never = result.reason
      return Number(exhaustive) || 500
    }
  }
}

// ---------------------------------------------------------------------------
// Workflow run
// ---------------------------------------------------------------------------

async function runDraftWorkflow(
  mastra: DraftWorkflowMastra,
  workflowId: "multi-step-draft" | "quick-draft",
  input: ExperienceDraftRequest,
  budgetMs: number,
): Promise<ExperienceDraftRouteResult> {
  let run: DraftWorkflowRun
  try {
    const workflow = mastra.getWorkflowById(workflowId)
    run = await workflow.createRun()
  } catch (error) {
    console.warn(
      `[forge-experience-draft] event=create_run_failed workflow=${workflowId} message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return {
      ok: false,
      reason: "internal_error",
      retryable: true,
      message: "failed to create workflow run",
    }
  }

  let workflowResult: DraftWorkflowRunResult
  try {
    workflowResult = await withTimeout(
      run.start({
        inputData: {
          prompt: input.prompt,
          locale: input.locale,
          candidates: input.candidates,
          exemplar: input.exemplar,
        },
      }),
      budgetMs,
    )
  } catch (error) {
    if (error instanceof DraftRouteTimeoutError) {
      // Best-effort cancel so the run stops burning LLM calls in the
      // background after we've stopped waiting for it.
      void run.cancel?.().catch(() => {})
      console.warn(
        `[forge-experience-draft] event=workflow_timeout workflow=${workflowId} budget_ms=${budgetMs}`,
      )
      return {
        ok: false,
        reason: "timeout",
        retryable: true,
        message: error.message,
      }
    }
    console.warn(
      `[forge-experience-draft] event=workflow_error workflow=${workflowId} message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return classifyWorkflowError(error)
  }

  if (workflowResult.status !== "success") {
    const failureError =
      (workflowResult as { error?: unknown }).error ??
      new Error(`workflow ended with status=${workflowResult.status}`)
    console.warn(
      `[forge-experience-draft] event=workflow_not_success workflow=${workflowId} status=${workflowResult.status}`,
    )
    return classifyWorkflowError(failureError)
  }

  // The workflow's fill/revise step Zod-parses against DraftExperienceSchema
  // before returning, so this re-parse is defense-in-depth (the wire contract
  // is the single-sourced schema). Both workflow output shapes carry `.draft`.
  const draftCandidate = (workflowResult.result as { draft?: unknown } | null)
    ?.draft
  const validated = DraftExperienceSchema.safeParse(draftCandidate)
  if (!validated.success) {
    console.warn(
      `[forge-experience-draft] event=result_missing_draft workflow=${workflowId}`,
    )
    return {
      ok: false,
      reason: "generation_failed",
      retryable: false,
      message: "workflow result did not carry a schema-valid draft",
    }
  }

  return { ok: true, draft: validated.data }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export type ExperienceDraftRouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  /**
   * Thunk returning the standalone Mastra instance. A thunk (not the instance)
   * so `index.ts` can pass `() => mastra` from inside the `new Mastra({...})`
   * literal without a temporal-dead-zone reference — the handler only resolves
   * it per-request, after construction.
   */
  getMastra: () => DraftWorkflowMastra
  /**
   * Internal wall-clock budget for the workflow run. Defaults to
   * `TIME_BUDGET_MS.multiStepWorkflow`; overridable for tests.
   */
  budgetMs?: number
}

export async function handleExperienceDraftRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  getMastra,
  budgetMs = TIME_BUDGET_MS.multiStepWorkflow,
}: ExperienceDraftRouteHandlerInput): Promise<ExperienceDraftRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return { status: 401, body: { error: "Service bearer required" } }
  }

  const raw = await readJson().catch(() => undefined)
  const parsed = ExperienceDraftRequestSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn(
      `[forge-experience-draft] event=invalid_input issues=${parsed.error.issues.length}`,
    )
    const result: ExperienceDraftRouteResult = {
      ok: false,
      reason: "invalid_input",
      retryable: false,
      message: "request body failed validation",
    }
    return { status: statusForResult(result), body: result }
  }

  const input = parsed.data
  const workflowId = input.mode === "quick" ? "quick-draft" : "multi-step-draft"
  const result = await runDraftWorkflow(
    getMastra(),
    workflowId,
    input,
    budgetMs,
  )
  return { status: statusForResult(result), body: result }
}
