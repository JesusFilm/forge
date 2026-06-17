import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { env, getOpenRouterApiKey } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"
import {
  loadConfiguredBiblePassage,
  type SubtitleBiblePassage,
} from "../../services/subtitle-enrichment/bible-source"
import {
  detectSubtitleScriptureContext,
  fallbackSubtitleScriptureContext,
  sanitizeSubtitleScriptureContext,
  type DetectSubtitleScriptureContextInput,
} from "../../services/subtitle-enrichment/scripture-context"
import {
  buildUnavailableTranscriptScriptureCorrectionResult,
  correctTranscriptScripture,
  type CorrectTranscriptScriptureInput,
} from "../../services/subtitle-enrichment/transcript-correction"
import {
  TranscriptScriptureCorrectionResultSchema,
  type TranscriptScriptureCorrectionResult,
} from "../../services/subtitle-enrichment/transcript-correction-types"
import {
  SubtitleProviderError,
  SubtitleTranslationContextSchema,
  type SubtitleScriptureContext,
} from "../../services/subtitle-enrichment/types"

const WORKFLOW_FAILURE_ERROR_PREFIX =
  "TRANSCRIPT_SCRIPTURE_CORRECTION_WORKFLOW_FAILED:"

const TranscriptSegmentSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    text: z.string().min(1).max(1_000),
  })
  .strict()
  .refine((segment) => segment.end >= segment.start, {
    message: "segment end must be greater than or equal to start",
    path: ["end"],
  })

export const TranscriptScriptureCorrectionInputSchema = z
  .object({
    assetId: z.string().min(1).describe("Manager artifact asset id."),
    sourceLanguage: z
      .string()
      .min(1)
      .describe("Source transcript language code or label."),
    segments: z
      .array(TranscriptSegmentSchema)
      .min(1)
      .max(1_000)
      .describe("Source transcript segments to audit."),
    model: z
      .string()
      .min(1)
      .optional()
      .describe("Optional OpenRouter chat model override."),
    translationContext: SubtitleTranslationContextSchema.optional().describe(
      "Optional video metadata and Bible references for scripture context.",
    ),
    provider: z
      .object({
        name: z.string().min(1).max(80).optional(),
        source: z.string().min(1).max(120).optional(),
      })
      .strict()
      .optional()
      .describe("Optional transcription provider provenance."),
  })
  .strict()

export type TranscriptScriptureCorrectionInput = z.output<
  typeof TranscriptScriptureCorrectionInputSchema
>

const TranscriptScriptureCorrectionFailureReasonSchema = z.enum([
  "invalid_input",
  "workflow_failed",
])

const TranscriptScriptureCorrectionSuccessSchema = z
  .object({
    ok: z.literal(true),
    mastraRunId: z.string(),
    correction: TranscriptScriptureCorrectionResultSchema,
  })
  .strict()

const TranscriptScriptureCorrectionFailureSchema = z
  .object({
    ok: z.literal(false),
    mastraRunId: z.string(),
    reason: TranscriptScriptureCorrectionFailureReasonSchema,
    retryable: z.boolean(),
    message: z.string().optional(),
  })
  .strict()

export const TranscriptScriptureCorrectionWorkflowResultSchema =
  z.discriminatedUnion("ok", [
    TranscriptScriptureCorrectionSuccessSchema,
    TranscriptScriptureCorrectionFailureSchema,
  ])

export type TranscriptScriptureCorrectionWorkflowResult = z.infer<
  typeof TranscriptScriptureCorrectionWorkflowResultSchema
>
type TranscriptScriptureCorrectionFailure = Extract<
  TranscriptScriptureCorrectionWorkflowResult,
  { ok: false }
>

type WorkflowOptions = {
  runId?: string
  apiKey?: string
  detectScriptureContext?: (
    input: DetectSubtitleScriptureContextInput,
  ) => Promise<SubtitleScriptureContext>
  loadBiblePassage?: typeof loadConfiguredBiblePassage
  correct?: (
    input: CorrectTranscriptScriptureInput,
  ) => Promise<TranscriptScriptureCorrectionResult>
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<TranscriptScriptureCorrectionWorkflowResult>
}

export type TranscriptScriptureCorrectionRouteOutcome = {
  status: number
  body: { result?: TranscriptScriptureCorrectionWorkflowResult; error?: string }
}

function failure(
  reason: TranscriptScriptureCorrectionFailure["reason"],
  options: {
    mastraRunId: string
    retryable: boolean
    message?: string
  },
): TranscriptScriptureCorrectionFailure {
  return {
    ok: false,
    mastraRunId: options.mastraRunId,
    reason,
    retryable: options.retryable,
    ...(options.message ? { message: options.message } : {}),
  }
}

function checkedReferenceCount(context: SubtitleScriptureContext): number {
  return context.likelyBibleReferences.length
}

function shouldCorrectScriptureContext(
  context: SubtitleScriptureContext,
): boolean {
  if (context.likelyBibleReferences.length > 0) {
    return true
  }
  return context.contentDomain === "bible_story" && context.confidence >= 0.5
}

function skippedResult(
  context: SubtitleScriptureContext,
): TranscriptScriptureCorrectionResult {
  return {
    status: "skipped",
    basis: "model_knowledge",
    contentDomain: context.contentDomain,
    confidence: context.confidence,
    checkedReferenceCount: checkedReferenceCount(context),
    candidateCount: 0,
    flaggedCount: 0,
    skippedReason: "no_scripture_context",
    likelyBibleReferences: context.likelyBibleReferences,
    findings: [],
  }
}

function unavailableResult(
  context: SubtitleScriptureContext,
  reason: string,
): TranscriptScriptureCorrectionResult {
  return buildUnavailableTranscriptScriptureCorrectionResult({
    scriptureContext: context,
    unavailableReason: reason,
  })
}

function providerUnavailableReason(error: unknown): string {
  if (error instanceof SubtitleProviderError) {
    return error.reason
  }
  return "provider_failed"
}

async function detectContext(
  input: TranscriptScriptureCorrectionInput,
  options: {
    apiKey?: string
    detectScriptureContext: (
      input: DetectSubtitleScriptureContextInput,
    ) => Promise<SubtitleScriptureContext>
  },
): Promise<SubtitleScriptureContext> {
  const fallback = fallbackSubtitleScriptureContext(input.translationContext)
  if (!options.apiKey) {
    return fallback
  }

  try {
    const detected = await options.detectScriptureContext({
      sourceLanguage: input.sourceLanguage,
      transcriptSegments: input.segments,
      translationContext: input.translationContext,
      model: input.model ?? env.TRANSCRIPT_SCRIPTURE_CORRECTION_MODEL,
      apiKey: options.apiKey,
      timeoutMs: env.TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS,
    })
    return sanitizeSubtitleScriptureContext(detected, input.translationContext)
  } catch {
    return fallback
  }
}

async function loadSourceBiblePassage(
  input: TranscriptScriptureCorrectionInput,
  context: SubtitleScriptureContext,
  loadBiblePassage: typeof loadConfiguredBiblePassage,
): Promise<SubtitleBiblePassage | undefined> {
  if (context.likelyBibleReferences.length === 0) {
    return undefined
  }

  const result = await loadBiblePassage({
    targetLanguage: input.sourceLanguage,
    references: context.likelyBibleReferences,
    timeoutMs: env.TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS,
  })
  return result.ok ? result.passage : undefined
}

export async function runTranscriptScriptureCorrectionWorkflow(
  rawInput: unknown,
  options: WorkflowOptions = {},
): Promise<TranscriptScriptureCorrectionWorkflowResult> {
  const mastraRunId = options.runId ?? randomUUID()
  const parsed = TranscriptScriptureCorrectionInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", {
      mastraRunId,
      retryable: false,
      message: "Transcript scripture correction input failed validation.",
    })
  }

  const input = parsed.data
  const apiKey = options.apiKey ?? getOpenRouterApiKey()
  const detectScriptureContext =
    options.detectScriptureContext ?? detectSubtitleScriptureContext
  const loadBiblePassage =
    options.loadBiblePassage ?? loadConfiguredBiblePassage
  const correct = options.correct ?? correctTranscriptScripture
  const scriptureContext = await detectContext(input, {
    apiKey,
    detectScriptureContext,
  })

  if (!shouldCorrectScriptureContext(scriptureContext)) {
    return {
      ok: true,
      mastraRunId,
      correction: skippedResult(scriptureContext),
    }
  }

  if (!apiKey) {
    return {
      ok: true,
      mastraRunId,
      correction: unavailableResult(
        scriptureContext,
        "provider_config_missing",
      ),
    }
  }

  let biblePassage: SubtitleBiblePassage | undefined
  try {
    biblePassage = await loadSourceBiblePassage(
      input,
      scriptureContext,
      loadBiblePassage,
    )
  } catch {
    biblePassage = undefined
  }

  try {
    const correction = await correct({
      sourceLanguage: input.sourceLanguage,
      segments: input.segments,
      scriptureContext,
      model: input.model ?? env.TRANSCRIPT_SCRIPTURE_CORRECTION_MODEL,
      apiKey,
      timeoutMs: env.TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS,
      ...(biblePassage ? { biblePassage } : {}),
    })
    return { ok: true, mastraRunId, correction }
  } catch (error) {
    return {
      ok: true,
      mastraRunId,
      correction: unavailableResult(
        scriptureContext,
        providerUnavailableReason(error),
      ),
    }
  }
}

class TranscriptScriptureCorrectionWorkflowFailureError extends Error {
  constructor(readonly result: TranscriptScriptureCorrectionFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "TranscriptScriptureCorrectionWorkflowFailureError"
  }
}

function throwWorkflowFailure(
  result: TranscriptScriptureCorrectionWorkflowResult,
): never {
  if (result.ok) {
    throw new Error("Cannot throw a successful transcript correction result")
  }
  throw new TranscriptScriptureCorrectionWorkflowFailureError(result)
}

function workflowFailureFromUnknown(
  value: unknown,
): TranscriptScriptureCorrectionFailure | null {
  if (value instanceof TranscriptScriptureCorrectionWorkflowFailureError) {
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
    const parsed = TranscriptScriptureCorrectionFailureSchema.safeParse(payload)
    return parsed.success ? parsed.data : null
  }
  return null
}

function workflowFailureFromRunResult(
  value: unknown,
): TranscriptScriptureCorrectionFailure | null {
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

const transcriptScriptureCorrectionStep = createStep({
  id: "run-transcript-scripture-correction",
  description:
    "Review source transcript segments for Bible-story ASR drift and return correction candidates.",
  inputSchema: TranscriptScriptureCorrectionInputSchema,
  outputSchema: TranscriptScriptureCorrectionWorkflowResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runTranscriptScriptureCorrectionWorkflow(inputData, {
      runId,
    })
    if (!result.ok) throwWorkflowFailure(result)
    return result
  },
})

export const transcriptScriptureCorrectionWorkflow = createWorkflow({
  id: "transcript-scripture-correction",
  description:
    "Find scripture-aware source transcript correction candidates for Manager enrichment jobs.",
  inputSchema: TranscriptScriptureCorrectionInputSchema,
  outputSchema: TranscriptScriptureCorrectionWorkflowResultSchema,
})
  .then(transcriptScriptureCorrectionStep)
  .commit()

export async function launchTranscriptScriptureCorrectionWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<TranscriptScriptureCorrectionWorkflowResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = TranscriptScriptureCorrectionInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", {
      mastraRunId: runId,
      retryable: false,
      message: "Transcript scripture correction input failed validation.",
    })
  }

  const run = await transcriptScriptureCorrectionWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ??
      failure("workflow_failed", {
        mastraRunId: runId,
        retryable: true,
        message: "Transcript scripture correction workflow run failed.",
      })
    )
  }

  if (result.status === "success") {
    return result.result as TranscriptScriptureCorrectionWorkflowResult
  }
  return (
    workflowFailureFromRunResult(result) ??
    failure("workflow_failed", {
      mastraRunId: runId,
      retryable: true,
      message: "Transcript scripture correction workflow run did not succeed.",
    })
  )
}

function routeStatusForResult(
  result: TranscriptScriptureCorrectionWorkflowResult,
): number {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  return 502
}

export async function handleTranscriptScriptureCorrectionRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchTranscriptScriptureCorrectionWorkflow,
}: RouteHandlerInput): Promise<TranscriptScriptureCorrectionRouteOutcome> {
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
          message: "Transcript scripture correction request body must be JSON.",
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
  shouldCorrectScriptureContext,
  skippedResult,
  unavailableResult,
  workflowFailureFromUnknown,
}
