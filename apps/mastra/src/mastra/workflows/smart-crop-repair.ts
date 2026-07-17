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
  SmartCropProviderError,
  requestShotRepairIntents,
  type ShotCropIntentsResult,
  type SmartCropShotIntent,
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

const WORKFLOW_FAILURE_ERROR_PREFIX = "SMART_CROP_REPAIR_WORKFLOW_FAILED:"

export const DEFAULT_SMART_CROP_REPAIR_MODEL = "qwen/qwen2.5-vl-72b-instruct"

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
    shotId: z.string().min(1),
    canonicalStart: z.number().min(0),
    canonicalEnd: z.number().min(0),
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

const RepairShotInputSchema = z
  .object({
    shotId: z.string().min(1).describe("Stable canonical shot id."),
    start: z.number().min(0).describe("Shot start in seconds."),
    end: z.number().min(0).describe("Shot end in seconds."),
    previousSegment: PlanSegmentSchema.describe(
      "Previous complete attempt segment for this shot.",
    ),
    frameUrls: z
      .array(z.string().url())
      .min(1)
      .max(3)
      .describe("Allowlisted https frame URLs for this shot (max 3)."),
  })
  .strict()

const RepairIssueInputSchema = z
  .object({
    severity: z.enum(SMART_CROP_QA_ISSUE_SEVERITIES),
    description: z.string().min(1).max(500),
    atSeconds: z.number().min(0).optional(),
    shotId: z.string().min(1).optional(),
  })
  .strict()

export const SmartCropRepairInputSchema = z
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
    attempt: z
      .object({
        index: z.number().int().min(1),
        previousPlanGeneratedAt: z.string().datetime(),
      })
      .strict(),
    issues: z.array(RepairIssueInputSchema).min(1).max(16),
    shots: z.array(RepairShotInputSchema).min(1).max(8),
    model: z
      .string()
      .min(1)
      .optional()
      .describe("Override the OpenRouter vision model."),
  })
  .strict()
  .superRefine((input, ctx) => {
    const shotIds = new Set<string>()
    for (const [index, shot] of input.shots.entries()) {
      if (shot.end <= shot.start) {
        ctx.addIssue({
          code: "custom",
          message: "shot end must be greater than start",
          path: ["shots", index, "end"],
        })
      }
      if (shotIds.has(shot.shotId)) {
        ctx.addIssue({
          code: "custom",
          message: "shot ids must be unique",
          path: ["shots", index, "shotId"],
        })
      }
      shotIds.add(shot.shotId)
      if (shot.previousSegment.shotId !== shot.shotId) {
        ctx.addIssue({
          code: "custom",
          message: "previousSegment shotId must match shotId",
          path: ["shots", index, "previousSegment", "shotId"],
        })
      }
      if (
        shot.previousSegment.canonicalEnd <= shot.previousSegment.canonicalStart
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "previousSegment canonicalEnd must be greater than canonicalStart",
          path: ["shots", index, "previousSegment", "canonicalEnd"],
        })
      }
    }

    for (const [index, issue] of input.issues.entries()) {
      if (issue.shotId != null && !shotIds.has(issue.shotId)) {
        ctx.addIssue({
          code: "custom",
          message: "issue shotId must refer to a requested shot",
          path: ["issues", index, "shotId"],
        })
      }
    }
  })

export type SmartCropRepairWorkflowInput = z.output<
  typeof SmartCropRepairInputSchema
>

const SmartCropRepairSuccessSchema = z
  .object({
    ok: z.literal(true),
    segments: z.array(PlanSegmentSchema).min(1),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .strict(),
    model: z.string(),
  })
  .strict()

export const SmartCropRepairResultSchema = z.discriminatedUnion("ok", [
  SmartCropRepairSuccessSchema,
  SmartCropWorkflowFailureSchema,
])

export type SmartCropRepairResult = z.infer<typeof SmartCropRepairResultSchema>
export type SmartCropRepairSegment = z.infer<typeof PlanSegmentSchema>

export type SmartCropRepairWorkflowOptions = {
  runId?: string
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  requestRepairIntents?: typeof requestShotRepairIntents
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<SmartCropRepairResult>
}

export type SmartCropRepairRouteOutcome = {
  status: number
  body: { result?: SmartCropRepairResult; error?: string }
}

function invalidInput(mastraRunId: string): SmartCropWorkflowFailure {
  return smartCropFailure("invalid_input", {
    retryable: false,
    message: "smart crop repair input failed validation",
    mastraRunId,
  })
}

function orderIntentsForRequestedShots(
  intents: readonly SmartCropShotIntent[],
  shots: readonly SmartCropRepairWorkflowInput["shots"][number][],
): SmartCropShotIntent[] {
  const intentsByShotId = new Map<string, SmartCropShotIntent>()
  for (const intent of intents) {
    if (intentsByShotId.has(intent.shotId)) {
      throw new SmartCropProviderError(
        "provider_invalid_output",
        false,
        `smart crop repair response repeated shotId ${intent.shotId}`,
      )
    }
    intentsByShotId.set(intent.shotId, intent)
  }

  const expectedShotIds = new Set(shots.map((shot) => shot.shotId))
  for (const shot of shots) {
    if (!intentsByShotId.has(shot.shotId)) {
      throw new SmartCropProviderError(
        "provider_invalid_output",
        false,
        `smart crop repair response is missing shotId ${shot.shotId}`,
      )
    }
  }
  for (const shotId of intentsByShotId.keys()) {
    if (!expectedShotIds.has(shotId)) {
      throw new SmartCropProviderError(
        "provider_invalid_output",
        false,
        `smart crop repair response includes unknown shotId ${shotId}`,
      )
    }
  }

  return shots.map((shot) => intentsByShotId.get(shot.shotId)!)
}

function segmentFromIntent(
  intent: SmartCropShotIntent,
  shot: SmartCropRepairWorkflowInput["shots"][number],
  source: SmartCropRepairWorkflowInput["source"],
): SmartCropRepairSegment {
  const previousSegment = shot.previousSegment
  const planned = intentToKeyframes(
    intent,
    {
      start: previousSegment.canonicalStart,
      end: previousSegment.canonicalEnd,
    },
    source,
  )

  const segment: SmartCropRepairSegment = {
    shotId: shot.shotId,
    canonicalStart: previousSegment.canonicalStart,
    canonicalEnd: previousSegment.canonicalEnd,
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
}

export async function runSmartCropRepairWorkflow(
  rawInput: unknown,
  options: SmartCropRepairWorkflowOptions = {},
): Promise<SmartCropRepairResult> {
  const mastraRunId = options.runId ?? randomUUID()
  const parsed = SmartCropRepairInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(mastraRunId)
  const input = parsed.data

  const allowedHosts = parseAllowedFrameHosts(
    env.SMART_CROP_IMAGE_URL_ALLOWED_HOSTS,
  )
  const model =
    input.model ?? env.SMART_CROP_PLAN_MODEL ?? DEFAULT_SMART_CROP_REPAIR_MODEL

  let intents: ShotCropIntentsResult
  try {
    for (const shot of input.shots) {
      for (const frameUrl of shot.frameUrls) {
        assertAllowedFrameUrl(frameUrl, allowedHosts)
      }
    }

    intents = await (options.requestRepairIntents ?? requestShotRepairIntents)({
      shots: input.shots,
      issues: input.issues,
      source: input.source,
      target: input.target,
      attempt: input.attempt,
      model,
      apiKey: options.apiKey ?? getOpenRouterApiKey(),
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    })

    const orderedIntents = orderIntentsForRequestedShots(
      intents.intents,
      input.shots,
    )
    return {
      ok: true,
      segments: input.shots.map((shot, index) =>
        segmentFromIntent(orderedIntents[index]!, shot, input.source),
      ),
      usage: intents.usage,
      model,
    }
  } catch (error) {
    return smartCropFailureFromError(error, mastraRunId)
  }
}

const smartCropRepairStep = createStep({
  id: "repair-smart-crop-segments",
  description:
    "Request replacement crop intents for selected shots and convert them into deterministic crop keyframes.",
  inputSchema: SmartCropRepairInputSchema,
  outputSchema: SmartCropRepairResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runSmartCropRepairWorkflow(inputData, { runId })
    if (!result.ok) {
      throwSmartCropWorkflowFailure(WORKFLOW_FAILURE_ERROR_PREFIX, result)
    }
    return result
  },
})

export const smartCropRepairWorkflow = createWorkflow({
  id: "smart-crop-repair",
  description:
    "Repair selected 9:16 smart-crop shots from previous plan segments and QA issues.",
  inputSchema: SmartCropRepairInputSchema,
  outputSchema: SmartCropRepairResultSchema,
})
  .then(smartCropRepairStep)
  .commit()

export async function launchSmartCropRepairWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<SmartCropRepairResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = SmartCropRepairInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(runId)

  const run = await smartCropRepairWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      smartCropFailureFromUnknown(WORKFLOW_FAILURE_ERROR_PREFIX, error) ??
      smartCropFailure("provider_failed", {
        retryable: true,
        message: "smart crop repair workflow run failed",
        mastraRunId: runId,
      })
    )
  }
  if (result.status === "success") return result.result as SmartCropRepairResult
  return (
    smartCropFailureFromRunResult(WORKFLOW_FAILURE_ERROR_PREFIX, result) ??
    smartCropFailure("provider_failed", {
      retryable: true,
      message: "smart crop repair workflow run did not succeed",
      mastraRunId: runId,
    })
  )
}

export async function handleSmartCropRepairRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchSmartCropRepairWorkflow,
}: RouteHandlerInput): Promise<SmartCropRepairRouteOutcome> {
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
  SmartCropRepairInputSchema,
  invalidInput,
  orderIntentsForRequestedShots,
}
