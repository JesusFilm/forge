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
  requestShotCropIntents,
  type ShotCropIntentsResult,
} from "../../services/smart-crop/openrouter-vision"
import {
  SMART_CROP_MODES,
  intentToKeyframes,
} from "../../services/smart-crop/planner"
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

const WORKFLOW_FAILURE_ERROR_PREFIX = "SMART_CROP_PLAN_WORKFLOW_FAILED:"

export const DEFAULT_SMART_CROP_PLAN_MODEL = "qwen/qwen2.5-vl-72b-instruct"

const PlanShotInputSchema = z
  .object({
    shotId: z.string().min(1).describe("Stable shot id, e.g. shot_00421."),
    start: z.number().min(0).describe("Shot start in seconds."),
    end: z.number().min(0).describe("Shot end in seconds."),
    frameUrls: z
      .array(z.string().url())
      .min(1)
      .max(3)
      .describe("Allowlisted https frame URLs for this shot (max 3)."),
  })
  .strict()

export const SmartCropPlanInputSchema = z
  .object({
    asset: z
      .object({
        assetId: z.string().min(1),
        playbackId: z.string().min(1).optional(),
      })
      .strict(),
    source: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        durationSeconds: z.number().positive(),
      })
      .strict(),
    target: z
      .object({
        aspectRatio: z.literal("9:16").default("9:16"),
        width: z.number().int().positive().default(1080),
        height: z.number().int().positive().default(1920),
      })
      .strict()
      .default({ aspectRatio: "9:16", width: 1080, height: 1920 }),
    cropMode: z
      .enum(["auto", ...SMART_CROP_MODES])
      .default("auto")
      .describe("Requested crop mode; auto lets the model decide per shot."),
    shots: z.array(PlanShotInputSchema).min(1).max(8),
    model: z
      .string()
      .min(1)
      .optional()
      .describe("Override the OpenRouter vision model."),
  })
  .strict()
  .superRefine((input, ctx) => {
    for (const [index, shot] of input.shots.entries()) {
      if (shot.end <= shot.start) {
        ctx.addIssue({
          code: "custom",
          message: "shot end must be greater than start",
          path: ["shots", index, "end"],
        })
      }
    }
  })

export type SmartCropPlanWorkflowInput = z.output<
  typeof SmartCropPlanInputSchema
>

const CropKeyframeSchema = z
  .object({
    progress: z.number().min(0).max(1),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict()

const NormalizedPointSchema = z
  .object({
    cx: z.number().min(0).max(1),
    cy: z.number().min(0).max(1),
  })
  .strict()

const FaceCenterSchema = z
  .object({
    start: NormalizedPointSchema,
    end: NormalizedPointSchema,
  })
  .strict()

const PlanSegmentSchema = z
  .object({
    shotId: z.string(),
    canonicalStart: z.number(),
    canonicalEnd: z.number(),
    mode: z.enum(SMART_CROP_MODES),
    primarySubject: z.string(),
    secondarySubjects: z.array(z.string()),
    avoidCutting: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    faceVisible: z.boolean().optional(),
    faceCenter: FaceCenterSchema.nullable().optional(),
    cropKeyframes: z.array(CropKeyframeSchema).length(2),
  })
  .strict()

const SmartCropPlanSuccessSchema = z
  .object({
    ok: z.literal(true),
    segments: z.array(PlanSegmentSchema),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .strict(),
    model: z.string(),
  })
  .strict()

export const SmartCropPlanResultSchema = z.discriminatedUnion("ok", [
  SmartCropPlanSuccessSchema,
  SmartCropWorkflowFailureSchema,
])

export type SmartCropPlanResult = z.infer<typeof SmartCropPlanResultSchema>
export type SmartCropPlanSegment = z.infer<typeof PlanSegmentSchema>

export type SmartCropPlanWorkflowOptions = {
  runId?: string
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  requestIntents?: typeof requestShotCropIntents
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<SmartCropPlanResult>
}

export type SmartCropPlanRouteOutcome = {
  status: number
  body: { result?: SmartCropPlanResult; error?: string }
}

function invalidInput(mastraRunId: string): SmartCropWorkflowFailure {
  return smartCropFailure("invalid_input", {
    retryable: false,
    message: "smart crop plan input failed validation",
    mastraRunId,
  })
}

export async function runSmartCropPlanWorkflow(
  rawInput: unknown,
  options: SmartCropPlanWorkflowOptions = {},
): Promise<SmartCropPlanResult> {
  const mastraRunId = options.runId ?? randomUUID()
  const parsed = SmartCropPlanInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(mastraRunId)
  const input = parsed.data

  const allowedHosts = parseAllowedFrameHosts(
    env.SMART_CROP_IMAGE_URL_ALLOWED_HOSTS,
  )
  let intents: ShotCropIntentsResult
  try {
    for (const shot of input.shots) {
      for (const frameUrl of shot.frameUrls) {
        assertAllowedFrameUrl(frameUrl, allowedHosts)
      }
    }

    const model =
      input.model ?? env.SMART_CROP_PLAN_MODEL ?? DEFAULT_SMART_CROP_PLAN_MODEL
    intents = await (options.requestIntents ?? requestShotCropIntents)({
      shots: input.shots,
      source: input.source,
      cropMode: input.cropMode,
      model,
      apiKey: options.apiKey ?? getOpenRouterApiKey(),
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    })

    const segments: SmartCropPlanSegment[] = input.shots.map((shot, index) => {
      const intent = intents.intents[index]!
      const planned = intentToKeyframes(intent, shot, input.source)
      const segment: SmartCropPlanSegment = {
        shotId: shot.shotId,
        canonicalStart: shot.start,
        canonicalEnd: shot.end,
        mode: planned.mode,
        primarySubject: intent.primarySubject,
        secondarySubjects: intent.secondarySubjects,
        avoidCutting: intent.avoidCutting,
        confidence: intent.confidence,
        faceVisible: intent.faceVisible,
        cropKeyframes: planned.cropKeyframes,
      }
      if (intent.faceCenter !== undefined) {
        segment.faceCenter = intent.faceCenter
      }
      return segment
    })

    return {
      ok: true,
      segments,
      usage: intents.usage,
      model:
        input.model ??
        env.SMART_CROP_PLAN_MODEL ??
        DEFAULT_SMART_CROP_PLAN_MODEL,
    }
  } catch (error) {
    return smartCropFailureFromError(error, mastraRunId)
  }
}

const smartCropPlanStep = createStep({
  id: "plan-smart-crop-segments",
  description:
    "Request per-shot crop intents from the vision model and convert them into deterministic crop keyframes.",
  inputSchema: SmartCropPlanInputSchema,
  outputSchema: SmartCropPlanResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runSmartCropPlanWorkflow(inputData, { runId })
    if (!result.ok) {
      throwSmartCropWorkflowFailure(WORKFLOW_FAILURE_ERROR_PREFIX, result)
    }
    return result
  },
})

export const smartCropPlanWorkflow = createWorkflow({
  id: "smart-crop-plan",
  description:
    "Plan 9:16 crop keyframes for canonical video shots from vision-model crop intents.",
  inputSchema: SmartCropPlanInputSchema,
  outputSchema: SmartCropPlanResultSchema,
})
  .then(smartCropPlanStep)
  .commit()

export async function launchSmartCropPlanWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<SmartCropPlanResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = SmartCropPlanInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(runId)

  const run = await smartCropPlanWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      smartCropFailureFromUnknown(WORKFLOW_FAILURE_ERROR_PREFIX, error) ??
      smartCropFailure("provider_failed", {
        retryable: true,
        message: "smart crop plan workflow run failed",
        mastraRunId: runId,
      })
    )
  }
  if (result.status === "success") return result.result as SmartCropPlanResult
  return (
    smartCropFailureFromRunResult(WORKFLOW_FAILURE_ERROR_PREFIX, result) ??
    smartCropFailure("provider_failed", {
      retryable: true,
      message: "smart crop plan workflow run did not succeed",
      mastraRunId: runId,
    })
  )
}

export async function handleSmartCropPlanRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchSmartCropPlanWorkflow,
}: RouteHandlerInput): Promise<SmartCropPlanRouteOutcome> {
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
  SmartCropPlanInputSchema,
  invalidInput,
}
