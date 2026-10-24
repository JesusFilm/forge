import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  SMART_CROP_GATE_FAILURES,
  SMART_CROP_MAPPING_METHODS,
  alignFingerprints,
} from "../../services/smart-crop/alignment"
import {
  SmartCropWorkflowFailureSchema,
  smartCropFailure,
  smartCropFailureFromRunResult,
  smartCropFailureFromUnknown,
  smartCropRouteStatus,
  throwSmartCropWorkflowFailure,
  type SmartCropWorkflowFailure,
} from "../../services/smart-crop/workflow-failure"

const WORKFLOW_FAILURE_ERROR_PREFIX = "SMART_CROP_ALIGN_WORKFLOW_FAILED:"

/**
 * Local schema for the `smart-crop-fingerprint` artifact produced by
 * crop-worker. Tolerant of extra fields (non-strict objects) so artifact
 * additions don't break alignment; the `kind`/`version` literals are the
 * cross-app wire contract.
 */
const FingerprintShotSchema = z.object({
  shotId: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  representativeHashes: z
    .array(
      z.object({
        time: z.number(),
        dhash: z.string().regex(/^[0-9a-fA-F]{16}$/),
      }),
    )
    .default([]),
})

const SmartCropFingerprintSchema = z.object({
  version: z.literal(1),
  kind: z.literal("smart-crop-fingerprint"),
  assetId: z.string().min(1),
  source: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationSeconds: z.number().positive(),
  }),
  shots: z.array(FingerprintShotSchema).min(1),
})

const GatesInputSchema = z
  .object({
    minOverallConfidence: z.number().min(0).max(1).optional(),
    minShotConfidence: z.number().min(0).max(1).optional(),
    maxUnmappedDurationPercent: z.number().min(0).max(100).optional(),
    maxConsecutiveUnmappedSeconds: z.number().min(0).optional(),
    maxTimingDriftSecondsPerShot: z.number().min(0).optional(),
  })
  .strict()

export const SmartCropAlignInputSchema = z
  .object({
    canonicalFingerprint: SmartCropFingerprintSchema,
    localizedFingerprint: SmartCropFingerprintSchema,
    language: z
      .string()
      .min(1)
      .optional()
      .describe("Localized language slug (provenance only)."),
    planShotIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Canonical shot ids that carry plan segments."),
    gates: GatesInputSchema.optional().describe(
      "Partial gate overrides merged over the smart-crop defaults.",
    ),
  })
  .strict()

export type SmartCropAlignWorkflowInput = z.output<
  typeof SmartCropAlignInputSchema
>

const TimelineMapSegmentSchema = z
  .object({
    canonicalShotId: z.string(),
    canonicalStart: z.number(),
    canonicalEnd: z.number(),
    localizedStart: z.number(),
    localizedEnd: z.number(),
    confidence: z.number().min(0).max(1),
  })
  .strict()

const TimelineMapSchema = z
  .object({
    mappingMethod: z.enum(SMART_CROP_MAPPING_METHODS),
    overallConfidence: z.number().min(0).max(1),
    unmappedDurationPercent: z.number().min(0).max(100),
    maxConsecutiveUnmappedSeconds: z.number().min(0),
    segments: z.array(TimelineMapSegmentSchema),
    gate: z
      .object({
        passed: z.boolean(),
        failures: z.array(z.enum(SMART_CROP_GATE_FAILURES)),
        config: z
          .object({
            minOverallConfidence: z.number(),
            minShotConfidence: z.number(),
            maxUnmappedDurationPercent: z.number(),
            maxConsecutiveUnmappedSeconds: z.number(),
            maxTimingDriftSecondsPerShot: z.number(),
          })
          .strict(),
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict()

const SmartCropAlignSuccessSchema = z
  .object({
    ok: z.literal(true),
    timelineMap: TimelineMapSchema,
  })
  .strict()

export const SmartCropAlignResultSchema = z.discriminatedUnion("ok", [
  SmartCropAlignSuccessSchema,
  SmartCropWorkflowFailureSchema,
])

export type SmartCropAlignResult = z.infer<typeof SmartCropAlignResultSchema>

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<SmartCropAlignResult>
}

export type SmartCropAlignRouteOutcome = {
  status: number
  body: { result?: SmartCropAlignResult; error?: string }
}

function invalidInput(mastraRunId: string): SmartCropWorkflowFailure {
  return smartCropFailure("invalid_input", {
    retryable: false,
    message: "smart crop align input failed validation",
    mastraRunId,
  })
}

export async function runSmartCropAlignWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<SmartCropAlignResult> {
  const mastraRunId = options.runId ?? randomUUID()
  const parsed = SmartCropAlignInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(mastraRunId)
  const input = parsed.data

  const timelineMap = alignFingerprints({
    canonical: input.canonicalFingerprint,
    localized: input.localizedFingerprint,
    gates: input.gates,
    planShotIds: input.planShotIds,
  })

  return { ok: true, timelineMap }
}

const smartCropAlignStep = createStep({
  id: "align-smart-crop-fingerprints",
  description:
    "Align localized shots to canonical shots and evaluate confidence gates.",
  inputSchema: SmartCropAlignInputSchema,
  outputSchema: SmartCropAlignResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runSmartCropAlignWorkflow(inputData, { runId })
    if (!result.ok) {
      throwSmartCropWorkflowFailure(WORKFLOW_FAILURE_ERROR_PREFIX, result)
    }
    return result
  },
})

export const smartCropAlignWorkflow = createWorkflow({
  id: "smart-crop-align",
  description:
    "Deterministically map a localized video timeline onto an approved canonical smart-crop plan.",
  inputSchema: SmartCropAlignInputSchema,
  outputSchema: SmartCropAlignResultSchema,
})
  .then(smartCropAlignStep)
  .commit()

export async function launchSmartCropAlignWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<SmartCropAlignResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = SmartCropAlignInputSchema.safeParse(rawInput)
  if (!parsed.success) return invalidInput(runId)

  const run = await smartCropAlignWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      smartCropFailureFromUnknown(WORKFLOW_FAILURE_ERROR_PREFIX, error) ??
      smartCropFailure("provider_failed", {
        retryable: true,
        message: "smart crop align workflow run failed",
        mastraRunId: runId,
      })
    )
  }
  if (result.status === "success") return result.result as SmartCropAlignResult
  return (
    smartCropFailureFromRunResult(WORKFLOW_FAILURE_ERROR_PREFIX, result) ??
    smartCropFailure("provider_failed", {
      retryable: true,
      message: "smart crop align workflow run did not succeed",
      mastraRunId: runId,
    })
  )
}

export async function handleSmartCropAlignRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchSmartCropAlignWorkflow,
}: RouteHandlerInput): Promise<SmartCropAlignRouteOutcome> {
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
  SmartCropFingerprintSchema,
  SmartCropAlignInputSchema,
  invalidInput,
}
