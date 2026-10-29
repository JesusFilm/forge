import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { env, getOpenRouterApiKey } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"
import { isSubtitleArtifactStorageProductionReady } from "../../services/subtitle-enrichment/storage"
import {
  runSubtitleSource,
  SubtitleSourceError,
  SubtitleSourceInputSchema,
  SubtitleSourceSchema,
  SubtitleSourceSummarySchema,
  type RunSubtitleSourceDeps,
  type SubtitleSourceSummary,
} from "../../services/subtitle-enrichment/source"
import {
  SubtitleLanguageResultSchema,
  SubtitleTranslationContextSchema,
  type SubtitleLanguageResult,
} from "../../services/subtitle-enrichment/types"
import {
  runSubtitleEnrichment,
  type RunSubtitleEnrichmentDeps,
} from "../../services/subtitle-enrichment/run"

const WORKFLOW_FAILURE_ERROR_PREFIX = "SUBTITLE_ENRICHMENT_WORKFLOW_FAILED:"

export const SubtitleEnrichmentInputSchema = z
  .object({
    assetId: z.string().min(1).describe("Manager artifact asset id."),
    sourceLanguage: z
      .string()
      .min(1)
      .describe("Source transcript language code or label."),
    targetLanguages: z
      .array(z.string().min(1))
      .max(100)
      .default([])
      .describe("Target subtitle languages to generate."),
    source: SubtitleSourceSchema.optional().describe(
      "Optional approved source artifact reuse or Mux subtitle acquisition before translation.",
    ),
    model: z
      .string()
      .min(1)
      .optional()
      .describe("Optional OpenRouter chat model override."),
    translationContext: SubtitleTranslationContextSchema.optional().describe(
      "Optional video metadata and Bible references for translation context.",
    ),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.source &&
      !SubtitleSourceInputSchema.safeParse({
        assetId: input.assetId,
        sourceLanguage: input.sourceLanguage,
        source: input.source,
      }).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Subtitle source identity or language is invalid.",
        path: ["source"],
      })
    }
  })

export type SubtitleEnrichmentInput = z.output<
  typeof SubtitleEnrichmentInputSchema
>

const SubtitleEnrichmentFailureReasonSchema = z.enum([
  "invalid_input",
  "config_missing",
  "provider_config_missing",
  "storage_failed",
  "all_languages_failed",
  "source_invalid",
  "source_failed",
  "source_config_missing",
])

const SubtitleEnrichmentSuccessSchema = z
  .object({
    ok: z.literal(true),
    mastraRunId: z.string(),
    languages: z.array(SubtitleLanguageResultSchema),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    source: SubtitleSourceSummarySchema.optional(),
  })
  .strict()

const SubtitleEnrichmentFailureSchema = z
  .object({
    ok: z.literal(false),
    mastraRunId: z.string(),
    reason: SubtitleEnrichmentFailureReasonSchema,
    retryable: z.boolean(),
    message: z.string().optional(),
    languages: z.array(SubtitleLanguageResultSchema).optional(),
    source: SubtitleSourceSummarySchema.optional(),
  })
  .strict()

export const SubtitleEnrichmentResultSchema = z.discriminatedUnion("ok", [
  SubtitleEnrichmentSuccessSchema,
  SubtitleEnrichmentFailureSchema,
])

export type SubtitleEnrichmentResult = z.infer<
  typeof SubtitleEnrichmentResultSchema
>
type SubtitleEnrichmentFailure = Extract<
  SubtitleEnrichmentResult,
  { ok: false }
>

type WorkflowOptions = {
  runId?: string
  apiKey?: string
  run?: typeof runSubtitleEnrichment
  deps?: RunSubtitleEnrichmentDeps
  sourceDeps?: RunSubtitleSourceDeps
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<SubtitleEnrichmentResult>
}

export type SubtitleEnrichmentRouteOutcome = {
  status: number
  body: { result?: SubtitleEnrichmentResult; error?: string }
}

function failure(
  reason: SubtitleEnrichmentFailure["reason"],
  options: {
    mastraRunId: string
    retryable: boolean
    message?: string
    languages?: SubtitleLanguageResult[]
    source?: SubtitleSourceSummary
  },
): SubtitleEnrichmentFailure {
  return {
    ok: false,
    mastraRunId: options.mastraRunId,
    reason,
    retryable: options.retryable,
    ...(options.message ? { message: options.message } : {}),
    ...(options.languages ? { languages: options.languages } : {}),
    ...(options.source ? { source: options.source } : {}),
  }
}

function hasProviderWork(input: SubtitleEnrichmentInput): boolean {
  return input.targetLanguages.some(
    (targetLanguage) => targetLanguage !== input.sourceLanguage,
  )
}

function summarizeSuccess(
  mastraRunId: string,
  languages: SubtitleLanguageResult[],
  source?: SubtitleSourceSummary,
): SubtitleEnrichmentResult {
  const succeeded = languages.filter(
    (result) => result.status === "completed",
  ).length
  const failed = languages.filter((result) => result.status === "failed").length

  if (languages.length > 0 && succeeded === 0) {
    return failure("all_languages_failed", {
      mastraRunId,
      retryable: true,
      languages,
      source,
      message: "Subtitle enrichment failed for all target languages.",
    })
  }

  return {
    ok: true,
    mastraRunId,
    languages,
    succeeded,
    failed,
    ...(source ? { source } : {}),
  }
}

export async function runSubtitleEnrichmentWorkflow(
  rawInput: unknown,
  options: WorkflowOptions = {},
): Promise<SubtitleEnrichmentResult> {
  const mastraRunId = options.runId ?? randomUUID()
  const parsed = SubtitleEnrichmentInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", {
      mastraRunId,
      retryable: false,
      message: "Subtitle enrichment input failed validation.",
    })
  }

  const input = parsed.data
  if (!isSubtitleArtifactStorageProductionReady()) {
    return failure("config_missing", {
      mastraRunId,
      retryable: false,
      message:
        "RAILWAY_S3_BUCKET, RAILWAY_S3_ACCESS_KEY_ID, and RAILWAY_S3_SECRET_ACCESS_KEY are required for production subtitle artifacts.",
    })
  }

  const apiKey = options.apiKey ?? getOpenRouterApiKey()
  if (hasProviderWork(input) && !apiKey) {
    return failure("provider_config_missing", {
      mastraRunId,
      retryable: false,
      message:
        "OPENROUTER_API_PAID_KEY or OPENROUTER_API_KEY is required for subtitle enrichment.",
    })
  }

  let source: SubtitleSourceSummary | undefined
  try {
    if (input.source) {
      const result = await runSubtitleSource(
        {
          assetId: input.assetId,
          sourceLanguage: input.sourceLanguage,
          source: input.source,
        },
        {
          readArtifact: options.deps?.readArtifact,
          writeArtifact: options.deps?.writeArtifact,
          ...options.sourceDeps,
        },
      )
      source = result.summary
    }
    const languages =
      input.source && input.targetLanguages.length === 0
        ? []
        : await (options.run ?? runSubtitleEnrichment)(
            {
              assetId: input.assetId,
              sourceLanguage: input.sourceLanguage,
              targetLanguages: input.targetLanguages,
              model: input.model ?? env.SUBTITLE_ENRICHMENT_MODEL,
              apiKey,
              timeoutMs: env.SUBTITLE_ENRICHMENT_TIMEOUT_MS,
              concurrency: env.SUBTITLE_ENRICHMENT_CONCURRENCY,
              translationContext: input.translationContext,
            },
            options.deps,
          )
    return summarizeSuccess(mastraRunId, languages, source)
  } catch (error) {
    if (error instanceof SubtitleSourceError) {
      return failure(error.reason, {
        mastraRunId,
        retryable: error.retryable,
        message: error.message,
        source,
      })
    }
    return failure("storage_failed", {
      mastraRunId,
      retryable: true,
      source,
      message:
        error instanceof Error
          ? error.message
          : "Subtitle enrichment storage failed.",
    })
  }
}

class SubtitleEnrichmentWorkflowFailureError extends Error {
  constructor(readonly result: SubtitleEnrichmentFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "SubtitleEnrichmentWorkflowFailureError"
  }
}

function throwWorkflowFailure(result: SubtitleEnrichmentResult): never {
  if (result.ok) {
    throw new Error("Cannot throw a successful subtitle enrichment result")
  }
  throw new SubtitleEnrichmentWorkflowFailureError(result)
}

function workflowFailureFromUnknown(
  value: unknown,
): SubtitleEnrichmentFailure | null {
  if (value instanceof SubtitleEnrichmentWorkflowFailureError) {
    return value.result
  }
  if (
    value instanceof Error &&
    value.message.startsWith(WORKFLOW_FAILURE_ERROR_PREFIX)
  ) {
    const rawPayload = value.message.slice(WORKFLOW_FAILURE_ERROR_PREFIX.length)
    let payload: unknown
    try {
      payload = JSON.parse(rawPayload)
    } catch {
      return null
    }
    const parsed = SubtitleEnrichmentFailureSchema.safeParse(payload)
    return parsed.success ? parsed.data : null
  }
  return null
}

function workflowFailureFromRunResult(
  value: unknown,
): SubtitleEnrichmentFailure | null {
  const direct = workflowFailureFromUnknown(value)
  if (direct) return direct
  if (value === null || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return (
    workflowFailureFromUnknown(record.error) ??
    workflowFailureFromUnknown(record.result) ??
    workflowFailureFromUnknown(record.snapshot)
  )
}

const subtitleEnrichmentStep = createStep({
  id: "run-subtitle-enrichment",
  description:
    "Translate and retime Manager transcript artifacts into generated subtitle artifacts.",
  inputSchema: SubtitleEnrichmentInputSchema,
  outputSchema: SubtitleEnrichmentResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runSubtitleEnrichmentWorkflow(inputData, { runId })
    if (!result.ok) throwWorkflowFailure(result)
    return result
  },
})

export const subtitleEnrichmentWorkflow = createWorkflow({
  id: "subtitle-enrichment",
  description:
    "Generate Manager-compatible subtitle and translation artifacts from transcript segments.",
  inputSchema: SubtitleEnrichmentInputSchema,
  outputSchema: SubtitleEnrichmentResultSchema,
})
  .then(subtitleEnrichmentStep)
  .commit()

export async function launchSubtitleEnrichmentWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<SubtitleEnrichmentResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = SubtitleEnrichmentInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", {
      mastraRunId: runId,
      retryable: false,
      message: "Subtitle enrichment input failed validation.",
    })
  }

  const run = await subtitleEnrichmentWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ??
      failure("storage_failed", {
        mastraRunId: runId,
        retryable: true,
        message: "Subtitle enrichment workflow run failed.",
      })
    )
  }

  if (result.status === "success") {
    return result.result as SubtitleEnrichmentResult
  }
  return (
    workflowFailureFromRunResult(result) ??
    failure("storage_failed", {
      mastraRunId: runId,
      retryable: true,
      message: "Subtitle enrichment workflow run did not succeed.",
    })
  )
}

function routeStatusForResult(result: SubtitleEnrichmentResult): number {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (
    result.reason === "config_missing" ||
    result.reason === "provider_config_missing" ||
    result.reason === "source_config_missing"
  ) {
    return 503
  }
  if (result.reason === "source_invalid") return 400
  return 502
}

export async function handleSubtitleEnrichmentRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchSubtitleEnrichmentWorkflow,
}: RouteHandlerInput): Promise<SubtitleEnrichmentRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return {
      status: 401,
      body: { error: "Service bearer required" },
    }
  }

  const runId = randomUUID()
  const body = await readJson().catch(() => undefined)
  const result =
    body === undefined
      ? failure("invalid_input", {
          mastraRunId: runId,
          retryable: false,
          message: "Subtitle enrichment request body must be JSON.",
        })
      : await launch(body, { runId })

  return {
    status: routeStatusForResult(result),
    body: { result },
  }
}

export const _internals = {
  WORKFLOW_FAILURE_ERROR_PREFIX,
  failure,
  summarizeSuccess,
  workflowFailureFromUnknown,
}
