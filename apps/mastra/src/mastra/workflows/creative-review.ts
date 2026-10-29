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

export const CreativeReviewInputSchema = z
  .object({
    kind: z.enum(CREATIVE_KINDS).default("carousel"),
    draft: z
      .string()
      .min(1)
      .describe(
        "The draft as the owner would read it (markdown or plain text).",
      ),
    lang: z.string().min(2).default("en"),
    context: z
      .string()
      .optional()
      .describe("Background: the passage, the long-form script, notes."),
    locked: z
      .string()
      .optional()
      .describe(
        "The owner's decisions, one per line; neither model may undo them.",
      ),
    revise: z
      .boolean()
      .default(true)
      .describe("Let the writer revise the draft after the review."),
    reviewerModel: z.string().min(1).default(DEFAULT_REVIEW_MODEL),
    writerModel: z.string().min(1).default(DEFAULT_WRITER_MODEL),
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
    markdown: z.string(),
    reviewerModel: z.string(),
    writerModel: z.string().optional(),
    mastraRunId: z.string(),
  })
  .strict()

const CreativeReviewFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum(["invalid_input", "provider_failed"]),
    message: z.string(),
    mastraRunId: z.string(),
  })
  .strict()

export type CreativeReviewOutcome =
  | z.infer<typeof CreativeReviewResultSchema>
  | z.infer<typeof CreativeReviewFailureSchema>

type LlmFactory = (model: string) => DevotionalLlm
const defaultLlm: LlmFactory = (model) =>
  createDevotionalLlm({ model, timeoutMs: 180_000 })

export async function runCreativeReviewWorkflow(
  input: CreativeReviewWorkflowInput,
  options: { runId: string; llm?: LlmFactory },
): Promise<CreativeReviewOutcome> {
  const llm = options.llm ?? defaultLlm
  try {
    const draft = {
      kind: input.kind,
      draft: input.draft,
      lang: input.lang,
      ...(input.context ? { context: input.context } : {}),
      ...(input.locked ? { locked: input.locked } : {}),
    }
    const result = await runCreativeReview(draft, {
      reviewer: llm(input.reviewerModel),
      ...(input.revise ? { writer: llm(input.writerModel) } : {}),
    })
    return {
      ok: true,
      review: result.review,
      ...(result.revision ? { revision: result.revision } : {}),
      markdown: reviewMarkdown(result, draft),
      reviewerModel: result.reviewerModel,
      ...(result.writerModel ? { writerModel: result.writerModel } : {}),
      mastraRunId: options.runId,
    }
  } catch (error) {
    return {
      ok: false,
      reason: "provider_failed",
      message: error instanceof Error ? error.message : String(error),
      mastraRunId: options.runId,
    }
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

type RouteHandlerInput = {
  authHeader: string | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: CreativeReviewWorkflowInput,
    options: { runId: string },
  ) => Promise<CreativeReviewOutcome>
}

export async function handleCreativeReviewRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = runCreativeReviewWorkflow,
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
          message: parsed.error.issues.map((i) => i.message).join("; "),
          mastraRunId: runId,
        },
      },
    }
  }
  const result = await launch(parsed.data, { runId })
  return { status: result.ok ? 200 : 502, body: { result } }
}
