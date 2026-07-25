import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { env, getOpenRouterApiKey } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"
import {
  assertAllowedFrameUrl,
  parseAllowedFrameHosts,
} from "../../services/smart-crop/frame-urls"
import {
  SMART_CROP_QA_ISSUE_SEVERITIES,
  SMART_CROP_QA_VERDICTS,
  requestRenderQaReview,
  type RenderQaReviewResult,
} from "../../services/smart-crop/openrouter-vision"
import {
  SmartCropWorkflowFailureSchema,
  smartCropFailure,
  smartCropFailureFromError,
  smartCropFailureFromRunResult,
  smartCropFailureFromUnknown,
  smartCropRouteStatus,
  throwSmartCropWorkflowFailure,
  type SmartCropWorkflowFailure,
} from "../../services/smart-crop/workflow-failure"

const WORKFLOW_FAILURE_ERROR_PREFIX = "SMART_CROP_QA_WORKFLOW_FAILED:"

export const DEFAULT_SMART_CROP_QA_MODEL = "google/gemini-2.5-flash"

export const SmartCropQaInputSchema = z
  .object({
    asset: z
      .object({
        assetId: z.string().min(1),
      })
      .strict(),
    renderMode: z
      .enum(["preview", "full"])
      .default("preview")
      .describe("Which render the frames were sampled from."),
    planSummary: z
      .object({
        segmentCount: z.number().int().nonnegative(),
        modes: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    frames: z
      .array(
        z
          .object({
            atSeconds: z.number().min(0),
            url: z.string().url(),
            shotId: z.string().min(1).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .describe("Allowlisted https preview frame URLs (max 8)."),
    model: z
      .string()
      .min(1)
      .optional()
      .describe("Override the OpenRouter vision model."),
  })
  .strict()

export type SmartCropQaWorkflowInput = z.output<typeof SmartCropQaInputSchema>

const QaIssueSchema = z
  .object({
    severity: z.enum(SMART_CROP_QA_ISSUE_SEVERITIES),
    description: z.string(),
    atSeconds: z.number().optional(),
    shotId: z.string().optional(),
  })
  .strict()

const SmartCropQaSuccessSchema = z
  .object({
    ok: z.literal(true),
    verdict: z.enum(SMART_CROP_QA_VERDICTS),
    issues: z.array(QaIssueSchema),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .strict(),
    model: z.string(),
  })
  .strict()

export const SmartCropQaResultSchema = z.discriminatedUnion("ok", [
  SmartCropQaSuccessSchema,
  SmartCropWorkflowFailureSchema,
])

export type SmartCropQaResult = z.infer<typeof SmartCropQaResultSchema>

export type SmartCropQaWorkflowOptions = {
  runId?: string
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  requestReview?: typeof requestRenderQaReview
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<SmartCropQaResult>
}

export type SmartCropQaRouteOutcome = {
  status: number
  body: { result?: SmartCropQaResult; error?: string }
}

function invalidInput(mastraRunId: string): SmartCropWorkflowFailure {
  return smartCropFailure("invalid_input", {
    retryable: false,
    message: "smart crop qa input failed validation",
    mastraRunId,
  })
}

export async function runSmartCropQaWorkflow(
  rawInput: unknown,
  options: SmartCropQaWorkflowOptions = {},
): Promise<SmartCropQaResult> {
  const mastraRunId = options.runId ?? randomUUID()
  const parsed = SmartCropQaInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(mastraRunId)
  const input = parsed.data

  const allowedHosts = parseAllowedFrameHosts(
    env.SMART_CROP_IMAGE_URL_ALLOWED_HOSTS,
  )
  const model =
    input.model ?? env.SMART_CROP_QA_MODEL ?? DEFAULT_SMART_CROP_QA_MODEL
  let review: RenderQaReviewResult
  try {
    for (const frame of input.frames) {
      assertAllowedFrameUrl(frame.url, allowedHosts)
    }

    review = await (options.requestReview ?? requestRenderQaReview)({
      frames: input.frames,
      planSummary: input.planSummary,
      renderMode: input.renderMode,
      model,
      apiKey: options.apiKey ?? getOpenRouterApiKey(),
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    })
  } catch (error) {
    return smartCropFailureFromError(error, mastraRunId)
  }

  return {
    ok: true,
    verdict: review.verdict,
    issues: review.issues,
    usage: review.usage,
    model,
  }
}

const smartCropQaStep = createStep({
  id: "review-smart-crop-render",
  description:
    "Review rendered 9:16 preview frames with a vision model and report a verdict plus issues.",
  inputSchema: SmartCropQaInputSchema,
  outputSchema: SmartCropQaResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runSmartCropQaWorkflow(inputData, { runId })
    if (!result.ok) {
      throwSmartCropWorkflowFailure(WORKFLOW_FAILURE_ERROR_PREFIX, result)
    }
    return result
  },
})

export const smartCropQaWorkflow = createWorkflow({
  id: "smart-crop-qa",
  description:
    "AI review of rendered smart-crop preview frames against the crop plan summary.",
  inputSchema: SmartCropQaInputSchema,
  outputSchema: SmartCropQaResultSchema,
})
  .then(smartCropQaStep)
  .commit()

export async function launchSmartCropQaWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<SmartCropQaResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = SmartCropQaInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(runId)

  const run = await smartCropQaWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      smartCropFailureFromUnknown(WORKFLOW_FAILURE_ERROR_PREFIX, error) ??
      smartCropFailure("provider_failed", {
        retryable: true,
        message: "smart crop qa workflow run failed",
        mastraRunId: runId,
      })
    )
  }
  if (result.status === "success") return result.result as SmartCropQaResult
  return (
    smartCropFailureFromRunResult(WORKFLOW_FAILURE_ERROR_PREFIX, result) ??
    smartCropFailure("provider_failed", {
      retryable: true,
      message: "smart crop qa workflow run did not succeed",
      mastraRunId: runId,
    })
  )
}

export async function handleSmartCropQaRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchSmartCropQaWorkflow,
}: RouteHandlerInput): Promise<SmartCropQaRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return {
      status: 401,
      body: { error: "Service bearer required" },
    }
  }

  const runId = randomUUID()
  const body = await readJson().catch(() => undefined)
  const result =
    body === undefined ? invalidInput(runId) : await launch(body, { runId })

  return {
    status: smartCropRouteStatus(result),
    body: { result },
  }
}

export const _internals = {
  WORKFLOW_FAILURE_ERROR_PREFIX,
  SmartCropQaInputSchema,
  invalidInput,
}
