import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { AbsoluteSearchEvalReportSchema } from "../../services/offline-search-eval/absolute-artifacts"
import { AbsoluteRelevanceJudgmentSetSchema } from "../../services/offline-search-eval/absolute-relevance-judgments"
import {
  runAbsoluteSearchEval,
  type AbsoluteSearchEvalInput,
  type AbsoluteSearchEvalResult,
} from "../../services/offline-search-eval/absolute-runner"

const AbsoluteSearchEvalInputSchema = z
  .object({
    split: z.enum(["development", "held-out"]).default("development"),
    backendMode: z.enum(["modern", "default"]).default("modern"),
    locales: z.array(z.string().min(1).max(32)).min(1).max(30).optional(),
    searchLimit: z.number().int().min(1).max(50).default(10),
    runPointwiseJudge: z.boolean().default(true),
    acknowledgeHeldOutReleaseGate: z.boolean().default(false),
    relevanceJudgmentSet: AbsoluteRelevanceJudgmentSetSchema.optional(),
    candidateIdentity: z
      .object({
        revision: z.string().trim().min(7).max(128),
        collections: z
          .object({
            catalog: z.string().trim().min(1).max(256),
            availability: z.string().trim().min(1).max(256),
            lexical: z.string().trim().min(1).max(256),
            transcripts: z.string().trim().min(1).max(256),
          })
          .strict(),
      })
      .strict()
      .optional(),
    operatorReview: z
      .object({
        approved: z.boolean(),
        reviewer: z.string().trim().min(1).max(128),
        notes: z.string().trim().min(1).max(2_000),
      })
      .strict()
      .optional(),
  })
  .strict()

const AbsoluteSearchEvalResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      reportPath: z.string(),
      report: AbsoluteSearchEvalReportSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: z.enum([
        "invalid_input",
        "config_missing",
        "judge_config_missing",
        "artifact_write_failed",
        "held_out_acknowledgement_required",
      ]),
      retryable: z.boolean(),
    })
    .strict(),
])

type AbsoluteRunner = (
  input: AbsoluteSearchEvalInput,
  options?: Parameters<typeof runAbsoluteSearchEval>[1],
) => Promise<AbsoluteSearchEvalResult>

export async function runAbsoluteSearchEvalWorkflow(
  rawInput: unknown,
  options: { runId?: string; runner?: AbsoluteRunner } = {},
): Promise<AbsoluteSearchEvalResult> {
  const parsed = AbsoluteSearchEvalInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, reason: "invalid_input", retryable: false }
  }
  return (options.runner ?? runAbsoluteSearchEval)(parsed.data, {
    runId: options.runId,
  })
}

const absoluteSearchEvalStep = createStep({
  id: "run-absolute-search-eval",
  description:
    "Run the immutable public Watch development or held-out query set against Admin MODERN search.",
  inputSchema: AbsoluteSearchEvalInputSchema,
  outputSchema: AbsoluteSearchEvalResultSchema,
  execute: ({ inputData, runId }) =>
    runAbsoluteSearchEvalWorkflow(inputData, { runId }),
})

export const absoluteSearchEvalWorkflow = createWorkflow({
  id: "absolute-search-eval",
  description:
    "Measure absolute multilingual Watch relevance, canonical deduplication, degradation, and latency without treating DEFAULT as correctness.",
  inputSchema: AbsoluteSearchEvalInputSchema,
  outputSchema: AbsoluteSearchEvalResultSchema,
})
  .then(absoluteSearchEvalStep)
  .commit()

export const _internal = {
  AbsoluteSearchEvalInputSchema,
  AbsoluteSearchEvalResultSchema,
}
