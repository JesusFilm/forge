import type { PrismaClient } from "@prisma/client"
import { canEditExperienceLocale } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { getMastra } from "@/mastra"
import { TIME_BUDGET_MS } from "@/mastra/budgets"
import { WorkflowStepError } from "@/mastra/workflows/multi-step-draft-workflow"
import { buildExemplarOutline } from "@/services/experience-ai/experience-ai-exemplar-outline"
import { selectExperienceExemplar } from "@/services/experience-ai/experience-ai-exemplar.service"
import type { DraftExperience, VideoCandidate } from "@forge/experience-schema"
import {
  ExperienceAiNormalizationError,
  loadExperienceAiVideoCandidates,
  normalizeExperienceDraft,
} from "@/services/experience-ai/experience-ai.service"
import type { NormalizedExperienceDraft } from "@/services/experience-ai/experience-ai.service"
import {
  classifyRepairability,
  REPAIR_CALL_TIMEOUT_MS,
  repairDraft,
  RepairDraftError,
} from "@/services/experience-ai/repair-draft"
import {
  launchMastraExperienceDraft,
  type MastraExperienceDraftFailureReason,
} from "@/services/mastra-experience-draft-client"

export type GenerateDraftActionInput = {
  localeId: string
  locale: string
  prompt: string
  currentTitle?: string
  currentMetaDescription?: string
  /**
   * When present, the action persists a thin `ExperienceChatMessage`
   * row with `producedBy: <workflow id>` linked to this thread after
   * a successful workflow run. The persisted message id is the
   * stable identifier the chat-rating service writes scores against.
   *
   * Optional for backwards compatibility — callers without a thread
   * context (legacy tests) get the workflow result without
   * persistence. The chat panel always supplies a threadId so
   * production runs are always rateable.
   */
  threadId?: string
  /**
   * Workflow variant to run:
   *  - `"full"` (default): plan → draft → critique → revise
   *    (~50–90s on free OpenRouter; better quality)
   *  - `"quick"`: plan → draft only
   *    (~roughly half the wall-clock; no second-pass refinement)
   *
   * The persisted message's `producedBy` reflects the variant:
   * `"multi-step-draft"` or `"quick-draft"`. Both are in the
   * ratable set so 👍/👎 still works on quick outputs.
   */
  mode?: "full" | "quick"
}

/// Typed error codes returned by the action layer. Keep in sync with
/// USER_MESSAGES below.
export type GenerateDraftActionErrorCode =
  | "EMPTY_PROMPT"
  | "LOCALE_NOT_FOUND"
  | "FORBIDDEN"
  | "CANVAS_NOT_EMPTY"
  | "NOT_CONFIGURED"
  | "NO_CANDIDATES"
  | "SCHEMA_MISMATCH"
  | "UNRESOLVED_REFERENCE"
  | "UPSTREAM_ERROR"
  | "UNKNOWN"

export type GenerateDraftActionResult =
  | {
      ok: true
      draft: {
        title: string
        metaDescription: string
        blocks: unknown[]
      }
      /**
       * Present when the caller supplied `threadId` and the post-
       * workflow chat message was persisted. The chat panel uses this
       * id to associate the 👍/👎 rating with the workflow output via
       * `POST /api/experience-chat/messages/{messageId}/rating`.
       *
       * Undefined for legacy callers without threadId — they get the
       * draft but no rateable artifact.
       */
      messageId?: string
      /**
       * Producer tag stamped on the persisted chat message. Always
       * `"multi-step-draft"` when `messageId` is present. The chat
       * panel reads it to decide whether to render the rating widget.
       */
      producedBy?: string
      /**
       * Mastra workflow `runId`. Surfaces to the chat-rating service
       * as the score record's `runId` so Mastra Studio's run→score
       * navigation works. Undefined if the workflow run failed before
       * persistence or the caller omitted threadId.
       */
      runId?: string
    }
  | {
      ok: false
      code: GenerateDraftActionErrorCode
      error: string
    }

export const USER_MESSAGES: Record<GenerateDraftActionErrorCode, string> = {
  EMPTY_PROMPT: "Enter a theme or story prompt first.",
  LOCALE_NOT_FOUND: "Locale not found.",
  FORBIDDEN: "You do not have permission to generate a draft for this locale.",
  CANVAS_NOT_EMPTY: "AI drafting is only available on an empty canvas in v1.",
  NOT_CONFIGURED: "AI drafting is not configured for this environment.",
  NO_CANDIDATES:
    "No suitable in-catalog videos were found for this theme. Try broader wording.",
  SCHEMA_MISMATCH:
    "The AI response could not be turned into a valid editor draft. Try again.",
  UNRESOLVED_REFERENCE:
    "The AI draft referenced a video or section that does not exist. Try again.",
  UPSTREAM_ERROR:
    "The AI drafting service is unavailable right now. Try again shortly.",
  UNKNOWN: "Unable to generate a draft right now.",
}

type GenerateDraftActionDeps = {
  prisma: Pick<
    PrismaClient,
    | "experienceLocale"
    | "video"
    | "videoLocale"
    | "videoDub"
    | "videoImage"
    | "contentRevision"
    | "experienceChatMessage"
    | "experienceChatThread"
  >
  user: Principal | null
}

function buildPrompt(input: GenerateDraftActionInput) {
  const parts = [input.prompt.trim()]
  if (input.currentTitle?.trim()) {
    parts.push(`Optional editor title hint: ${input.currentTitle.trim()}`)
  }
  if (input.currentMetaDescription?.trim()) {
    parts.push(
      `Optional editor description hint: ${input.currentMetaDescription.trim()}`,
    )
  }
  return parts.join("\n\n")
}

function fail(
  code: GenerateDraftActionErrorCode,
): Extract<GenerateDraftActionResult, { ok: false }> {
  return { ok: false, code, error: USER_MESSAGES[code] }
}

function isNonEmptyBlocksValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === "object") {
    // ContentRevision snapshots are stored as { v, data: { blocks: [...] } }.
    const data = (value as { data?: unknown }).data
    if (data && typeof data === "object") {
      const blocks = (data as { blocks?: unknown }).blocks
      if (Array.isArray(blocks)) return blocks.length > 0
    }
    const blocks = (value as { blocks?: unknown }).blocks
    if (Array.isArray(blocks)) return blocks.length > 0
  }
  return false
}

/**
 * Classify a WorkflowStepError into the action's editor-safe error code
 * union. Discriminator-driven (step + reason); never inspects
 * err.message except as a narrow fallback for the env-missing signal
 * (the workflow's typed-error layer doesn't yet distinguish
 * "provider not configured" from generic agent failures).
 */
function classifyWorkflowError(
  err: WorkflowStepError,
): GenerateDraftActionErrorCode {
  if (err.reason === "schema_mismatch") return "SCHEMA_MISMATCH"
  if (err.reason === "timeout") return "UPSTREAM_ERROR"
  // truncated (U4) — the provider hit its output-token ceiling
  // mid-document (`finishReason === "length"`). Non-repairable, so it
  // maps to UPSTREAM_ERROR (the editor sees "service unavailable, try
  // again") and is NEVER routed into the repair loop (U5).
  if (err.reason === "truncated") return "UPSTREAM_ERROR"
  // agent_error — surface NOT_CONFIGURED when the message indicates a
  // missing provider key. Anything else is UPSTREAM_ERROR. The
  // not-configured signal would be cleaner as its own typed
  // discriminator at the workflow layer; recorded as a follow-up.
  if (/openrouter|openai|api[_ ]?key|not configured/i.test(err.message)) {
    return "NOT_CONFIGURED"
  }
  return "UPSTREAM_ERROR"
}

/**
 * Classify an `ExperienceAiNormalizationError` into the action's editor-safe
 * error-code union. Branches on `err.code` (a closed literal union) — NEVER
 * on `err.message`. The exhaustive `switch` with a `never`-typed default makes
 * a future normalization code a compile-time error here until it is mapped, so
 * a new structural-failure mode can never silently fall through to `UNKNOWN`.
 *
 * Mapping rationale:
 *  - `INVALID_BLOCKS` / `BELOW_MIN_BLOCKS` → `SCHEMA_MISMATCH`: the normalized
 *    output is structurally wrong (bad shape, or below the generation
 *    minimum) — same editor-facing class as a workflow schema mismatch.
 *  - `UNKNOWN_VIDEO_REF` / `UNKNOWN_SECTION_REF` / `DUPLICATE_SECTION_REF` →
 *    `UNRESOLVED_REFERENCE`: the model referenced (or duplicated) something
 *    that cannot be resolved against the real candidate/section set.
 */
function classifyNormalizationError(
  err: ExperienceAiNormalizationError,
): GenerateDraftActionErrorCode {
  switch (err.code) {
    case "INVALID_BLOCKS":
    case "BELOW_MIN_BLOCKS":
      return "SCHEMA_MISMATCH"
    case "UNKNOWN_VIDEO_REF":
    case "UNKNOWN_SECTION_REF":
    case "DUPLICATE_SECTION_REF":
      return "UNRESOLVED_REFERENCE"
    default: {
      const exhaustive: never = err.code
      return exhaustive
    }
  }
}

/**
 * Map a remote draft-route `{ ok:false }` reason onto the action's editor-safe
 * error-code union (consolidation U6). `config_missing` never reaches here — it
 * degrades to the in-process path at the call site. Exhaustive `switch` +
 * `never` so a new client reason is a compile-time forcing function.
 *  - `auth_failed` → `NOT_CONFIGURED` (admin's bearer doesn't match mastra's
 *    allowlist — a deploy/config gap, not a transient outage).
 *  - `timeout` / `network_error` / `parse_error` / `invalid_input` /
 *    `internal_error` → `UPSTREAM_ERROR` (the editor sees "try again shortly";
 *    timeout is NOT retried here so there is no retry storm).
 *  - `generation_failed` → `SCHEMA_MISMATCH` when non-retryable (the workflow's
 *    schema_mismatch / truncated), else `UPSTREAM_ERROR` (transient agent error).
 */
function mapRemoteDraftFailure(
  reason: MastraExperienceDraftFailureReason,
  retryable: boolean,
): GenerateDraftActionErrorCode {
  switch (reason) {
    case "auth_failed":
      return "NOT_CONFIGURED"
    case "generation_failed":
      return retryable ? "UPSTREAM_ERROR" : "SCHEMA_MISMATCH"
    case "config_missing":
    case "timeout":
    case "network_error":
    case "parse_error":
    case "invalid_input":
    case "internal_error":
      return "UPSTREAM_ERROR"
    default: {
      const exhaustive: never = reason
      void exhaustive
      return "UPSTREAM_ERROR"
    }
  }
}

const ACTION_BUDGET_MS = TIME_BUDGET_MS.multiStepWorkflow

/**
 * Repair-phase wall-clock budget for the REMOTE draft path (consolidation U6).
 * The remote leg is bounded separately by `MASTRA_DRAFT_TIMEOUT_MS`; once a
 * draft arrives, the validate→repair loop gets this fresh window (room for the
 * default 2 × `REPAIR_CALL_TIMEOUT_MS` repair calls) rather than whatever is
 * left of `ACTION_BUDGET_MS` after a possibly-long remote generation. The
 * in-process path keeps the single shared `ACTION_BUDGET_MS` deadline.
 */
const REMOTE_REPAIR_BUDGET_MS = 60_000

class ActionTimeoutError extends Error {
  readonly name = "ActionTimeoutError"
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(
      () => reject(new ActionTimeoutError("workflow exceeded wall-clock cap")),
      ms,
    )
    p.then(
      (value) => {
        clearTimeout(handle)
        resolve(value)
      },
      (err) => {
        clearTimeout(handle)
        reject(err)
      },
    )
  })
}

/**
 * U5 — the validate→repair-with-error-feedback boundary loop. Wraps the
 * NORMALIZE→`BlocksSchema` boundary AFTER a successful workflow run so the
 * action NEVER returns or persists a draft that fails `BlocksSchema`.
 *
 * Loop:
 *  1. `normalizeExperienceDraft(draft, candidates)` (validates against
 *     `BlocksSchema` + the generation minimum inside the service).
 *  2. On success → return the normalized draft (caller proceeds to persist).
 *  3. On `ExperienceAiNormalizationError`:
 *       - classify via `classifyRepairability` (`instanceof` + `.code`,
 *         never message regex).
 *       - `schema_violation` AND attempts remain → re-prompt a SINGLE agent
 *         (NOT a workflow re-run) with the offending draft + concrete errors
 *         → loop with the repaired draft.
 *       - `structurally_impossible` (UNKNOWN_*_REF / DUPLICATE_SECTION_REF;
 *         the model can't invent a candidate that doesn't exist) OR attempts
 *         exhausted → RE-THROW the typed error so the action's catch ladder
 *         fails closed via `classifyNormalizationError`. Never persisted.
 *
 * Budget: the whole action already runs inside `withTimeout(...,
 * ACTION_BUDGET_MS)`. Each repair call gets a per-call timeout that is the
 * SMALLER of `REPAIR_CALL_TIMEOUT_MS` (30s) and the budget remaining until
 * `deadline` — strictly under the outer ceiling so a repair call never
 * out-races the action timeout (cf.
 * docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md).
 * If no meaningful budget remains, the loop stops re-prompting and fails
 * closed with the last typed error rather than dispatching a doomed call.
 *
 * Returns the normalized draft. Throws either the original
 * `ExperienceAiNormalizationError` (fail-closed) or a repair-output error;
 * both fall to the action's catch ladder which never persists off-shape
 * output.
 */
const REPAIR_BUDGET_FLOOR_MS = 2_000

/**
 * Runtime default for the repair-attempt cap. `env` applies the Zod
 * `.default(2)` in normal boot, but t3-env's `skipValidation` mode (CI /
 * build phase) returns `process.env` as-is WITHOUT applying Zod defaults, so
 * `env.EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS` can be `undefined` there. The
 * runtime `?? DEFAULT_MAX_REPAIR_ATTEMPTS` fallback keeps the cap bounded in
 * every mode (cf.
 * docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md).
 */
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2

async function normalizeWithRepair(args: {
  draft: DraftExperience
  candidates: readonly VideoCandidate[]
  maxAttempts: number
  deadline: number
  abortSignal?: AbortSignal
}): Promise<NormalizedExperienceDraft> {
  let currentDraft = args.draft
  // attempt 0 is the initial normalize of the workflow's draft; attempts
  // 1..maxAttempts are repair re-prompts. The loop runs at most
  // maxAttempts + 1 normalize passes.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return normalizeExperienceDraft(
        currentDraft,
        args.candidates as VideoCandidate[],
      )
    } catch (error) {
      if (!(error instanceof ExperienceAiNormalizationError)) {
        // Non-normalization throw — let the action's catch ladder handle it
        // (e.g. UNKNOWN). Never swallowed into the repair path.
        throw error
      }
      const repairClass = classifyRepairability(error)
      // structurally_impossible never enters the loop; attempts exhausted
      // also fails closed.
      if (repairClass !== "schema_violation" || attempt >= args.maxAttempts) {
        throw error
      }
      const remaining = args.deadline - Date.now()
      if (remaining <= REPAIR_BUDGET_FLOOR_MS) {
        // No meaningful budget left for another LLM round-trip — fail closed
        // with the typed error rather than dispatch a doomed repair call.
        console.warn(
          "[runGenerateDraftAction] event=repair_skipped reason=budget_exhausted attempt=" +
            (attempt + 1),
        )
        throw error
      }
      const timeoutMs = Math.min(REPAIR_CALL_TIMEOUT_MS, remaining)
      console.warn(
        "[runGenerateDraftAction] event=repair_attempt attempt=" +
          (attempt + 1) +
          " class=" +
          repairClass +
          " code=" +
          error.code,
      )
      currentDraft = await repairDraft({
        draft: currentDraft,
        candidates: args.candidates,
        error,
        attempt: attempt + 1,
        mastra: getMastra(),
        abortSignal: args.abortSignal,
        timeoutMs,
      })
      // loop: re-normalize the repaired draft.
    }
  }
}

/**
 * Test/wiring seams for the flag-gated remote draft cutover (consolidation U6).
 * Production passes nothing — `remoteEnabled` resolves from
 * `EXPERIENCE_AI_REMOTE_DRAFT` and `launchRemoteDraft` is the real client.
 */
export type GenerateDraftActionOverrides = {
  remoteEnabled?: boolean
  launchRemoteDraft?: typeof launchMastraExperienceDraft
}

export async function runGenerateDraftAction(
  deps: GenerateDraftActionDeps,
  input: GenerateDraftActionInput,
  overrides: GenerateDraftActionOverrides = {},
): Promise<GenerateDraftActionResult> {
  const prompt = input.prompt.trim()
  if (!prompt) {
    return fail("EMPTY_PROMPT")
  }

  const locale = await deps.prisma.experienceLocale.findUnique({
    where: { id: input.localeId },
    select: {
      id: true,
      status: true,
      blocks: true,
      experienceId: true,
      experience: {
        select: {
          ownerId: true,
          archivedAt: true,
        },
      },
    },
  })

  if (!locale) {
    return fail("LOCALE_NOT_FOUND")
  }

  if (!canEditExperienceLocale(deps.user, locale)) {
    return fail("FORBIDDEN")
  }

  // Server-side empty-canvas guard (R7). Read canonical blocks AND any
  // pending DRAFT revision; non-empty in either path means the action
  // must NOT invoke the workflow.
  if (isNonEmptyBlocksValue(locale.blocks)) {
    return fail("CANVAS_NOT_EMPTY")
  }

  const draftRevision = await deps.prisma.contentRevision.findFirst({
    where: {
      entityType: "ExperienceLocale",
      entityId: locale.id,
      status: "DRAFT",
    },
    select: { snapshot: true },
  })

  if (draftRevision && isNonEmptyBlocksValue(draftRevision.snapshot)) {
    return fail("CANVAS_NOT_EMPTY")
  }

  // Candidate video lookup happens at the action layer (previously
  // inside the legacy service). The workflow itself is candidate-
  // aware; it just needs the list passed via inputData.
  let candidates: Awaited<ReturnType<typeof loadExperienceAiVideoCandidates>>
  try {
    candidates = await loadExperienceAiVideoCandidates(
      deps.prisma as PrismaClient,
      { locale: input.locale, prompt },
    )
  } catch (error) {
    console.error("[runGenerateDraftAction] candidate-loader error", error)
    return fail("UPSTREAM_ERROR")
  }

  if (candidates.length === 0) {
    return fail("NO_CANDIDATES")
  }

  // Pick a real published experience as a structure-and-voice reference
  // for the drafter (relevance-matched, Easter fallback). Best-effort and
  // NON-FATAL: candidates are required, an exemplar is not. Any failure
  // degrades to no exemplar (pre-feature behaviour) so generation never
  // breaks because the reference was unavailable. The user's theme prompt
  // (not the title/desc-augmented buildPrompt) drives relevance matching.
  let exemplar: string | undefined
  try {
    const selection = await selectExperienceExemplar(
      { prisma: deps.prisma as PrismaClient },
      {
        prompt,
        locale: input.locale,
        excludeExperienceId: locale.experienceId,
      },
    )
    if (selection) {
      exemplar = buildExemplarOutline(selection.row) ?? undefined
    }
  } catch (error) {
    console.warn(
      "[runGenerateDraftAction] event=exemplar_selection_failed error=" +
        (error instanceof Error ? error.message : String(error)),
    )
  }

  // Captured outside the try so the timeout/error path can best-effort
  // cancel the run handle (see the catch block). Mastra's Run exposes
  // `cancel(): Promise<void>` (@mastra/core 1.33.1) which aborts the
  // in-flight execution and marks the run 'canceled' in storage; without
  // it, ActionTimeoutError abandons the promise but the workflow keeps
  // burning LLM calls in the background.
  let activeRun: { cancel?: () => Promise<void>; runId?: string } | undefined
  const producedBy = input.mode === "quick" ? "quick-draft" : "multi-step-draft"
  // Single wall-clock deadline for the whole action — the workflow run AND
  // the U5 repair loop must finish before it. `withTimeout` enforces it for
  // the workflow leg; `normalizeWithRepair` sizes each repair call's
  // per-call timeout under the budget remaining until this deadline so a
  // repair re-prompt never out-races the action ceiling.
  const actionDeadline = Date.now() + ACTION_BUDGET_MS
  const fullPrompt = buildPrompt(input)
  const remoteEnabled =
    overrides.remoteEnabled ?? env.EXPERIENCE_AI_REMOTE_DRAFT === "true"
  const launchRemoteDraft =
    overrides.launchRemoteDraft ?? launchMastraExperienceDraft

  // In-process workflow leg (the flag-off path AND the config_missing
  // fallback). Captures `activeRun` so the timeout/error path can best-effort
  // cancel it; returns the produced (DraftExperienceSchema-valid) draft, or
  // throws WorkflowStepError / ActionTimeoutError into the catch ladder below.
  const runInProcessWorkflow = async (): Promise<DraftExperience> => {
    const mastra = getMastra()
    const workflowId =
      input.mode === "quick" ? "quick-draft" : "multi-step-draft"
    const workflow = mastra.getWorkflowById(workflowId)
    const run = await workflow.createRun()
    activeRun = run as typeof activeRun
    const workflowResult = await withTimeout(
      run.start({
        inputData: {
          prompt: fullPrompt,
          locale: input.locale,
          candidates,
          exemplar,
        },
      }),
      ACTION_BUDGET_MS,
    )

    if (workflowResult.status !== "success") {
      // The workflow result envelope reports `failed`/`tripwire`/etc.
      // Re-throw the underlying error so the catch block does typed
      // classification.
      const failureError =
        (workflowResult as { error?: unknown }).error ??
        new Error(
          `multi-step-draft workflow ended with status=${workflowResult.status}`,
        )
      throw failureError
    }

    // The workflow output is Zod-parsed inside its fill/revise step against
    // DraftExperienceSchema, so the cast here reflects the runtime contract —
    // not a guess. If that contract drifts, the step throws
    // WorkflowStepError(schema_mismatch) before we get here.
    return (workflowResult.result as { draft: DraftExperience }).draft
  }

  try {
    // Flag-gated cutover (U6): run the draft remotely via the standalone
    // `/forge-experience-draft` route when enabled, else in-process. The
    // remote leg is bounded by its own client timeout
    // (`MASTRA_DRAFT_TIMEOUT_MS` > mastra's internal budget); `config_missing`
    // (caller vars unset) degrades to the in-process path so a flag flip
    // without deployed caller vars never breaks generation. Other remote
    // failures map to the editor-safe error surface (no retry storm).
    let draft: DraftExperience
    // Repair-loop deadline: the shared `ACTION_BUDGET_MS` for the in-process
    // path (workflow + repair under one budget); a fresh window AFTER the
    // separately-bounded remote leg returns.
    let repairDeadline = actionDeadline
    if (remoteEnabled) {
      const remote = await launchRemoteDraft({
        prompt: fullPrompt,
        locale: input.locale,
        candidates,
        exemplar,
        mode: input.mode === "quick" ? "quick" : "multi",
      })
      if (remote.ok) {
        draft = remote.draft
        repairDeadline = Date.now() + REMOTE_REPAIR_BUDGET_MS
      } else if (remote.reason === "config_missing") {
        console.warn(
          "[runGenerateDraftAction] event=remote_draft_config_missing falling_back=in_process",
        )
        draft = await runInProcessWorkflow()
      } else {
        console.warn(
          "[runGenerateDraftAction] event=remote_draft_failed reason=" +
            remote.reason +
            " retryable=" +
            remote.retryable,
        )
        return fail(mapRemoteDraftFailure(remote.reason, remote.retryable))
      }
    } else {
      draft = await runInProcessWorkflow()
    }

    // U5 — fail-closed boundary loop. Normalize + validate against
    // BlocksSchema; on a repair-eligible (schema_violation) failure with
    // attempts remaining, re-prompt a SINGLE agent with the offending draft
    // + concrete errors and re-normalize. structurally_impossible and
    // exhausted attempts re-throw the typed error to the catch ladder
    // (classifyNormalizationError) so off-shape output is NEVER persisted or
    // returned. Workflow-INTERNAL failures stay on the existing
    // classifyWorkflowError path above — only a draft that was actually
    // produced reaches here.
    const normalized = await normalizeWithRepair({
      draft,
      candidates,
      maxAttempts:
        env.EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS ?? DEFAULT_MAX_REPAIR_ATTEMPTS,
      deadline: repairDeadline,
    })

    // Persist a thin assistant message linked to the active thread so
    // the workflow output is identifiable + rateable. The full draft
    // body is in `mutationsApplied` — the canvas hydrates from the
    // returned `result.draft`, not from the message row.
    //
    // Failure to persist is non-fatal: the draft still ships back to
    // the editor. We surface the persistence failure as a structured
    // log so a missing rateable id is debuggable, but never fail the
    // whole action because the rating widget couldn't be wired up.
    let messageId: string | undefined
    // `runId` comes from the in-process run handle (captured on `activeRun`).
    // The remote path leaves `activeRun` undefined — its run lives in the
    // mastra service's storage — so `runId` is undefined there (the field is
    // optional and only surfaces for Studio run→score navigation).
    const runId = activeRun?.runId
    if (input.threadId) {
      // Cross-check the thread belongs to the authorized locale before
      // persisting under it (mirrors loadThreadForAuth's select). The
      // ABAC pass above only authorized `locale.id`; without this guard a
      // caller could thread a draft message onto a thread for a DIFFERENT
      // locale by passing a foreign threadId. Skip persist on mismatch
      // (the draft itself still ships back); never fail the whole action.
      const ownerThread = await deps.prisma.experienceChatThread.findUnique({
        where: { id: input.threadId },
        select: { experienceLocaleId: true },
      })
      if (!ownerThread || ownerThread.experienceLocaleId !== locale.id) {
        console.warn(
          "[runGenerateDraftAction] event=thread_locale_mismatch thread_id=" +
            input.threadId +
            " locale_id=" +
            locale.id,
        )
        return {
          ok: true,
          draft: {
            title: normalized.title,
            metaDescription: normalized.metaDescription,
            blocks: normalized.blocks,
          },
        }
      }
      try {
        const assistantContent =
          `Generated full page draft: ${normalized.title || "(untitled)"}`.slice(
            0,
            500,
          )
        const persisted = await deps.prisma.experienceChatMessage.create({
          data: {
            threadId: input.threadId,
            role: "ASSISTANT",
            content: assistantContent,
            providerKind: "mastra",
            producedBy,
            mutationsApplied: {
              title: normalized.title,
              metaDescription: normalized.metaDescription,
              blocks: normalized.blocks,
            } as unknown as object,
          },
          select: { id: true },
        })
        messageId = persisted.id
        // Bump the thread's lastMessageAt so the chat sidebar shows
        // the most recent activity. Matches the chat service's own
        // post-message update.
        await deps.prisma.experienceChatThread
          .update({
            where: { id: input.threadId },
            data: { lastMessageAt: new Date() },
          })
          .catch(() => {
            // Non-fatal — last-message-at is presentational. The
            // assistant message itself already persisted.
          })
      } catch (persistError) {
        console.warn(
          "[runGenerateDraftAction] event=persist_message_failed thread_id=" +
            input.threadId +
            " error=" +
            (persistError instanceof Error
              ? persistError.message
              : String(persistError)),
        )
      }
    }

    return {
      ok: true,
      draft: {
        title: normalized.title,
        metaDescription: normalized.metaDescription,
        blocks: normalized.blocks,
      },
      messageId,
      producedBy: messageId ? producedBy : undefined,
      runId: messageId ? runId : undefined,
    }
  } catch (error) {
    if (error instanceof WorkflowStepError) {
      return fail(classifyWorkflowError(error))
    }
    if (error instanceof ActionTimeoutError) {
      // Best-effort cancel of the orphaned run so it stops consuming LLM
      // calls in the background. Fire-and-forget + swallow: the action
      // already timed out and the editor UI single-flights the Generate
      // buttons (draftWorkflowStatus === "generating" gating), so a
      // failed cancel only leaves a run to age out, never double-fires.
      if (typeof activeRun?.cancel === "function") {
        void activeRun.cancel().catch((cancelError: unknown) => {
          console.warn(
            "[runGenerateDraftAction] event=run_cancel_failed error=" +
              (cancelError instanceof Error
                ? cancelError.message
                : String(cancelError)),
          )
        })
      }
      return fail("UPSTREAM_ERROR")
    }
    // U5 — the repair agent's OWN output was unusable (un-parseable, still
    // schema-invalid, or the repair call timed out). Fail closed: a timeout
    // maps to UPSTREAM_ERROR (the service is slow/unavailable); an
    // un-parseable / still-invalid repair output maps to SCHEMA_MISMATCH
    // (same editor-facing class as a normalize schema miss). Either way the
    // off-shape draft is NEVER persisted or returned.
    if (error instanceof RepairDraftError) {
      return fail(
        error.reason === "timeout" ? "UPSTREAM_ERROR" : "SCHEMA_MISMATCH",
      )
    }
    // normalizeExperienceDraft runs OUTSIDE the workflow, so its typed error
    // would otherwise fall through to the generic UNKNOWN catch. Classify it
    // on `.code` instead so the editor sees a structure/reference message.
    if (error instanceof ExperienceAiNormalizationError) {
      return fail(classifyNormalizationError(error))
    }
    // UNKNOWN is reserved STRICTLY for genuinely-unrecognized throws. Log in
    // the plain-string `[label] event=name key=value` format (Railway logsV2
    // silences JSON.stringify payloads from this runtime route path).
    console.error(
      "[runGenerateDraftAction] event=unknown_error error=" +
        (error instanceof Error ? error.message : String(error)),
    )
    return fail("UNKNOWN")
  }
}
