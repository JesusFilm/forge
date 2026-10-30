import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  CREATIVE_KINDS,
  CreativeReviewSchema,
  CreativeRevisionSchema,
  DEFAULT_REVIEW_MODEL,
  DEFAULT_WRITER_MODEL,
  reviewMarkdown,
  runCreativeReview,
} from "../../services/devotional/creative-review"
import {
  createDevotionalLlm,
  DevotionalLlmError,
  type DevotionalLlm,
} from "../../services/devotional/llm"

/**
 * `creative-review`: a devotional draft (script, Shorts plan or carousel)
 * reviewed by one model and revised by another, so a teammate can run the
 * owner's two-model review from Mastra Studio without a local setup
 * (owner, 2026-10-29). The logic lives in
 * `services/devotional/creative-review.ts`; story sessions run the same code
 * through `src/scripts/creative-review.ts`.
 */

/**
 * Models a caller may pick. The route bills the shared OpenRouter key, so the
 * choice is closed here; the local CLI keeps free-form `--reviewer/--writer`.
 */
export const CREATIVE_REVIEW_MODELS = [
  DEFAULT_REVIEW_MODEL,
  DEFAULT_WRITER_MODEL,
] as const

/**
 * Per-call budget for the hosted path: one retry at most, so the two calls
 * finish (or fail) within about ten minutes instead of the client's 3 x 180 s
 * per call. A long Russian script sheet has taken close to three minutes.
 */
const HOSTED_CALL_TIMEOUT_MS = 150_000
const HOSTED_CALL_ATTEMPTS = 2

export const CreativeReviewInputSchema = z
  .object({
    kind: z.enum(CREATIVE_KINDS).default("carousel"),
    draft: z
      .string()
      .min(1)
      .max(40_000)
      .describe(
        "The draft as the owner would read it (markdown or plain text).",
      ),
    lang: z
      .string()
      .regex(/^[a-z]{2}(-[A-Za-z]{2})?$/)
      .default("en"),
    context: z
      .string()
      .max(60_000)
      .optional()
      .describe("Background: the passage, the long-form script, notes."),
    locked: z
      .string()
      .max(4_000)
      .optional()
      .describe(
        "The owner's decisions, one per line; neither model may undo them.",
      ),
    revise: z
      .boolean()
      .default(true)
      .describe("Let the writer revise the draft after the review."),
    reviewerModel: z.enum(CREATIVE_REVIEW_MODELS).default(DEFAULT_REVIEW_MODEL),
    writerModel: z.enum(CREATIVE_REVIEW_MODELS).default(DEFAULT_WRITER_MODEL),
  })
  .strict()
export type CreativeReviewWorkflowInput = z.output<
  typeof CreativeReviewInputSchema
>

export const CreativeReviewResultSchema = z
  .object({
    ok: z.literal(true),
    review: CreativeReviewSchema,
    revision: CreativeRevisionSchema.optional(),
    revisionError: z.string().optional(),
    markdown: z.string(),
    reviewerModel: z.string(),
    writerModel: z.string().optional(),
    mastraRunId: z.string(),
  })
  .strict()

const CreativeReviewFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum(["invalid_input", "config_missing", "provider_failed"]),
    message: z.string(),
    mastraRunId: z.string(),
  })
  .strict()

export type CreativeReviewOutcome =
  | z.infer<typeof CreativeReviewResultSchema>
  | z.infer<typeof CreativeReviewFailureSchema>

type LlmFactory = (model: string) => DevotionalLlm
const defaultLlm: LlmFactory = (model) =>
  createDevotionalLlm({
    model,
    timeoutMs: HOSTED_CALL_TIMEOUT_MS,
    maxAttempts: HOSTED_CALL_ATTEMPTS,
  })

function failure(
  reason: z.infer<typeof CreativeReviewFailureSchema>["reason"],
  message: string,
  mastraRunId: string,
): CreativeReviewOutcome {
  // Plain string, not JSON: Railway logsV2 drops JSON-stringified lines.
  // Never log the draft itself.
  console.error(
    `[creative-review] event=failed runId=${mastraRunId} reason=${reason} message=${JSON.stringify(message.slice(0, 300))}`,
  )
  return { ok: false, reason, message, mastraRunId }
}

export async function runCreativeReviewWorkflow(
  input: CreativeReviewWorkflowInput,
  options: { runId: string; llm?: LlmFactory },
): Promise<CreativeReviewOutcome> {
  const llm = options.llm ?? defaultLlm
  const draft = {
    kind: input.kind,
    draft: input.draft,
    lang: input.lang,
    ...(input.context ? { context: input.context } : {}),
    ...(input.locked ? { locked: input.locked } : {}),
  }
  let models: { reviewer: DevotionalLlm; writer?: DevotionalLlm }
  try {
    models = {
      reviewer: llm(input.reviewerModel),
      ...(input.revise ? { writer: llm(input.writerModel) } : {}),
    }
  } catch (error) {
    if (
      error instanceof DevotionalLlmError &&
      error.code === "missing_credentials"
    )
      return failure("config_missing", error.message, options.runId)
    throw error
  }
  try {
    const result = await runCreativeReview(draft, models)
    if (result.revisionError)
      console.error(
        `[creative-review] event=revision_failed runId=${options.runId} message=${JSON.stringify(result.revisionError.slice(0, 300))}`,
      )
    return {
      ok: true,
      review: result.review,
      ...(result.revision ? { revision: result.revision } : {}),
      ...(result.revisionError ? { revisionError: result.revisionError } : {}),
      markdown: reviewMarkdown(result, draft),
      reviewerModel: result.reviewerModel,
      ...(result.writerModel ? { writerModel: result.writerModel } : {}),
      mastraRunId: options.runId,
    }
  } catch (error) {
    return failure(
      "provider_failed",
      error instanceof Error ? error.message : String(error),
      options.runId,
    )
  }
}

const creativeReviewStep = createStep({
  id: "review-and-revise-draft",
  description:
    "Review a devotional draft with one model and revise it with another, keeping the owner's decisions.",
  inputSchema: CreativeReviewInputSchema,
  outputSchema: z.union([
    CreativeReviewResultSchema,
    CreativeReviewFailureSchema,
  ]),
  execute: async ({ inputData, runId }) =>
    runCreativeReviewWorkflow(inputData, { runId }),
})

export const creativeReviewWorkflow = createWorkflow({
  id: "creative-review",
  description:
    "Two-model creative review for Daily Bible Pause drafts: GPT reviews, Claude revises (owner's decisions stay fixed).",
  inputSchema: CreativeReviewInputSchema,
  outputSchema: z.union([
    CreativeReviewResultSchema,
    CreativeReviewFailureSchema,
  ]),
})
  .then(creativeReviewStep)
  .commit()

/**
 * Run through the registered workflow, so the run id the route returns is a
 * real Mastra run a teammate can open in Studio.
 */
export async function launchCreativeReviewWorkflow(
  input: CreativeReviewWorkflowInput,
  options: { runId: string },
): Promise<CreativeReviewOutcome> {
  const run = await creativeReviewWorkflow.createRun({ runId: options.runId })
  const result = await run.start({ inputData: input })
  if (result.status === "success") return result.result
  return failure(
    "provider_failed",
    `workflow ended with status ${result.status}`,
    options.runId,
  )
}

type RouteHandlerInput = {
  authHeader: string | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: CreativeReviewWorkflowInput,
    options: { runId: string },
  ) => Promise<CreativeReviewOutcome>
}

function routeStatus(result: CreativeReviewOutcome): number {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "config_missing") return 503
  return 502
}

export async function handleCreativeReviewRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchCreativeReviewWorkflow,
}: RouteHandlerInput): Promise<{ status: number; body: unknown }> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return { status: 401, body: { error: "Service bearer required" } }
  }
  const runId = randomUUID()
  const parsed = CreativeReviewInputSchema.safeParse(
    await readJson().catch(() => undefined),
  )
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        result: {
          ok: false,
          reason: "invalid_input",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
            .join("; "),
          mastraRunId: runId,
        },
      },
    }
  }
  const result = await launch(parsed.data, { runId }).catch((error: unknown) =>
    failure(
      "provider_failed",
      error instanceof Error ? error.message : String(error),
      runId,
    ),
  )
  return { status: routeStatus(result), body: { result } }
}
