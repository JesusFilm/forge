import type { PrismaClient } from "@prisma/client"
import { canEditExperienceLocale } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { getMastra } from "@/mastra"
import { TIME_BUDGET_MS } from "@/mastra/budgets"
import { WorkflowStepError } from "@/mastra/workflows/multi-step-draft-workflow"
import type { DraftExperience } from "@/services/experience-ai/experience-ai.schemas"
import {
  loadExperienceAiVideoCandidates,
  normalizeExperienceDraft,
} from "@/services/experience-ai/experience-ai.service"

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
  // agent_error — surface NOT_CONFIGURED when the message indicates a
  // missing provider key. Anything else is UPSTREAM_ERROR. The
  // not-configured signal would be cleaner as its own typed
  // discriminator at the workflow layer; recorded as a follow-up.
  if (/openrouter|openai|api[_ ]?key|not configured/i.test(err.message)) {
    return "NOT_CONFIGURED"
  }
  return "UPSTREAM_ERROR"
}

const ACTION_BUDGET_MS = TIME_BUDGET_MS.multiStepWorkflow

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

export async function runGenerateDraftAction(
  deps: GenerateDraftActionDeps,
  input: GenerateDraftActionInput,
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

  // Captured outside the try so the timeout/error path can best-effort
  // cancel the run handle (see the catch block). Mastra's Run exposes
  // `cancel(): Promise<void>` (@mastra/core 1.33.1) which aborts the
  // in-flight execution and marks the run 'canceled' in storage; without
  // it, ActionTimeoutError abandons the promise but the workflow keeps
  // burning LLM calls in the background.
  let activeRun: { cancel?: () => Promise<void>; runId?: string } | undefined
  const producedBy = input.mode === "quick" ? "quick-draft" : "multi-step-draft"
  try {
    const mastra = getMastra()
    const workflowId =
      input.mode === "quick" ? "quick-draft" : "multi-step-draft"
    const workflow = mastra.getWorkflowById(workflowId)
    const run = await workflow.createRun()
    activeRun = run as typeof activeRun
    const workflowResult = await withTimeout(
      run.start({
        inputData: {
          prompt: buildPrompt(input),
          locale: input.locale,
          candidates,
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

    // The workflow output is Zod-parsed inside its revise step against
    // DraftExperienceSchema, so the cast here reflects the runtime
    // contract — not a guess. If that contract drifts, the revise step
    // throws WorkflowStepError(schema_mismatch) before we get here.
    const draft = (workflowResult.result as { draft: DraftExperience }).draft

    const normalized = normalizeExperienceDraft(draft, candidates)

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
    const runId = (run as { runId?: string } | undefined)?.runId
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
    console.error("[runGenerateDraftAction] unexpected error", error)
    return fail("UNKNOWN")
  }
}
