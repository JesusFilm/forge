import { createHash, randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import {
  callAdminExperienceIngest,
  type AdminExperienceEmbeddingIngestPayload,
  type AdminExperienceEmbeddingIngestResult,
  type AdminExperienceIngestClientResult,
  type ExperienceEmbeddingGenerationMode,
} from "../../services/admin-experience-ingest-client"
import {
  EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS,
  EmbeddingProviderError,
  requestEmbeddingVectors,
  validateEmbeddingProviderResult,
  type EmbeddingProviderResult,
} from "../../services/embedding-provider"
import { env, getExperienceEmbeddingProviderConfig } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"

const WORKFLOW_FAILURE_ERROR_PREFIX = "EXPERIENCE_EMBEDDING_WORKFLOW_FAILED:"

const GenerationModeSchema = z
  .enum(["idempotent", "repair", "force", "model-upgrade"])
  .default("idempotent")

const TargetSchema = z
  .object({
    experienceId: z.string().min(1),
    experienceLocaleId: z.string().min(1),
    locale: z.string().min(1),
    slug: z.string().min(1).optional(),
  })
  .strict()

const SourceSchema = z
  .object({
    text: z.string().min(1),
    contentHash: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict()

const ModelOptionsSchema = z
  .object({
    name: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
  })
  .strict()

export const ExperienceEmbeddingWorkflowInputSchema = z
  .object({
    target: TargetSchema,
    source: SourceSchema,
    mode: GenerationModeSchema,
    model: ModelOptionsSchema.optional(),
  })
  .strict()

const PlannedRunSummarySchema = z
  .object({
    target: TargetSchema,
    source: z
      .object({
        sourceTextLength: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

const WorkflowSuccessSchema = z
  .object({
    ok: z.literal(true),
    status: z.enum([
      "created",
      "unchanged",
      "repaired",
      "forced",
      "model_upgraded",
    ]),
    target: z
      .object({
        experienceId: z.string(),
        experienceLocaleId: z.string(),
        locale: z.string(),
      })
      .strict(),
    providerTokens: z.number().int().nonnegative(),
    model: z.string(),
    provider: z.string(),
    dimensions: z.number().int().positive(),
    nativeDimensions: z.number().int().positive().optional(),
    transformVersion: z.string().optional(),
    mastraRunId: z.string(),
    sourceContentHash: z.string(),
  })
  .strict()

const WorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum([
      "invalid_input",
      "provider_config_missing",
      "provider_auth_failed",
      "provider_failed",
      "provider_dimension_mismatch",
      "admin_config_missing",
      "admin_auth_failed",
      "admin_ingest_rejected",
      "admin_ingest_failed",
    ]),
    retryable: z.boolean(),
    adminStatus: z.string().optional(),
    adminReason: z.string().optional(),
  })
  .strict()

export const ExperienceEmbeddingWorkflowOutputSchema = z.discriminatedUnion(
  "ok",
  [WorkflowSuccessSchema, WorkflowFailureSchema],
)

export type ExperienceEmbeddingWorkflowInput = z.infer<
  typeof ExperienceEmbeddingWorkflowInputSchema
>
type PlannedRun = {
  target: ExperienceEmbeddingWorkflowInput["target"]
  source: ExperienceEmbeddingWorkflowInput["source"]
  mode: z.infer<typeof GenerationModeSchema>
  model: {
    name: string
    provider: string
  }
  generation: {
    generatedAt: string
    mastraRunId: string
  }
}
type EmbeddedRun = PlannedRun & {
  embedding: number[]
  dimensions: number
  nativeDimensions?: number
  transformVersion?: string
  providerTokenCount: number
}
export type ExperienceEmbeddingWorkflowResult = z.infer<
  typeof ExperienceEmbeddingWorkflowOutputSchema
>
type ExperienceEmbeddingWorkflowFailure = z.infer<typeof WorkflowFailureSchema>
type ExperienceEmbeddingWorkflowFailureReason =
  ExperienceEmbeddingWorkflowFailure["reason"]

const PlannedRunStepOutputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), summary: PlannedRunSummarySchema }).strict(),
  WorkflowFailureSchema,
])

const EmbeddedRunStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      summary: PlannedRunSummarySchema,
    })
    .strict(),
  WorkflowFailureSchema,
])

export type ExperienceEmbeddingWorkflowOptions = {
  runId?: string
  generatedAt?: string
  apiKey?: string
  embeddingsBaseUrl?: string
  ingestUrl?: string
  adminBearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  embeddingRequester?: (
    input: string[],
    options: {
      expectedDimensions: number
      context: string
      itemLabel: string
    },
  ) => Promise<EmbeddingProviderResult>
  adminIngestClient?: (
    payload: AdminExperienceEmbeddingIngestPayload,
  ) => Promise<AdminExperienceIngestClientResult>
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<ExperienceEmbeddingWorkflowResult>
}

export type ExperienceEmbeddingRouteOutcome = {
  status: number
  body: { result?: ExperienceEmbeddingWorkflowResult; error?: string }
}

const embeddedRunByMastraRunId = new Map<string, EmbeddedRun>()
const MAX_RETRYABLE_ATTEMPTS = 3

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

async function retryOperation<T>(
  operation: () => Promise<T>,
  isRetryableFailure: (value: T | undefined, error: unknown) => boolean,
): Promise<T> {
  let lastValue: T | undefined
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_RETRYABLE_ATTEMPTS; attempt += 1) {
    try {
      const value = await operation()
      if (
        attempt < MAX_RETRYABLE_ATTEMPTS &&
        isRetryableFailure(value, undefined)
      ) {
        lastValue = value
        continue
      }
      return value
    } catch (error) {
      if (
        attempt >= MAX_RETRYABLE_ATTEMPTS ||
        !isRetryableFailure(undefined, error)
      ) {
        throw error
      }
      lastError = error
    }
  }

  if (lastValue !== undefined) return lastValue
  throw lastError
}

function summarizePlannedRun(planned: PlannedRun) {
  return {
    target: planned.target,
    source: {
      sourceTextLength: planned.source.text.length,
    },
  }
}

function summarizeEmbeddedRun(embedded: EmbeddedRun) {
  return {
    summary: summarizePlannedRun(embedded),
  }
}

function failure(
  reason: ExperienceEmbeddingWorkflowFailureReason,
  options: {
    retryable: boolean
    adminStatus?: string
    adminReason?: string
  },
): ExperienceEmbeddingWorkflowFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    adminStatus: options.adminStatus,
    adminReason: options.adminReason,
  }
}

class ExperienceEmbeddingWorkflowFailureError extends Error {
  constructor(readonly result: ExperienceEmbeddingWorkflowFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "ExperienceEmbeddingWorkflowFailureError"
  }
}

function throwWorkflowFailure(
  result: ExperienceEmbeddingWorkflowFailure,
): never {
  throw new ExperienceEmbeddingWorkflowFailureError(result)
}

function workflowFailureFromUnknown(
  value: unknown,
): ExperienceEmbeddingWorkflowFailure | null {
  if (value instanceof ExperienceEmbeddingWorkflowFailureError) {
    return value.result
  }

  const message =
    value instanceof Error
      ? value.message
      : typeof value === "object" && value !== null && "message" in value
        ? String((value as { message?: unknown }).message ?? "")
        : typeof value === "string"
          ? value
          : ""

  const prefixIndex = message.indexOf(WORKFLOW_FAILURE_ERROR_PREFIX)
  if (prefixIndex < 0) return null

  const parsed = WorkflowFailureSchema.safeParse(
    JSON.parse(
      message.slice(prefixIndex + WORKFLOW_FAILURE_ERROR_PREFIX.length),
    ),
  )
  return parsed.success ? parsed.data : null
}

function workflowFailureFromRunResult(
  value: unknown,
): ExperienceEmbeddingWorkflowFailure | null {
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

function failureFromEmbeddingError(
  error: unknown,
): ExperienceEmbeddingWorkflowFailure {
  if (error instanceof EmbeddingProviderError) {
    if (error.code === "config_missing") {
      return failure("provider_config_missing", {
        retryable: false,
      })
    }
    if (error.code === "auth_failed") {
      return failure("provider_auth_failed", {
        retryable: false,
      })
    }
    if (error.code === "dimension_mismatch") {
      return failure("provider_dimension_mismatch", {
        retryable: false,
      })
    }
    return failure("provider_failed", {
      retryable: error.retryable,
    })
  }

  return failure("provider_failed", { retryable: true })
}

export function planExperienceEmbeddingRun(
  rawInput: unknown,
  options: { mastraRunId: string; generatedAt?: string } = {
    mastraRunId: randomUUID(),
  },
): PlannedRun {
  const input = ExperienceEmbeddingWorkflowInputSchema.parse(rawInput)
  const providerConfig = getExperienceEmbeddingProviderConfig()
  if (sha256Text(input.source.text) !== input.source.contentHash) {
    throw new Error("source hash mismatch")
  }
  return {
    target: input.target,
    source: input.source,
    mode: input.mode,
    model: {
      name: input.model?.name ?? providerConfig.model,
      provider: input.model?.provider ?? providerConfig.provider,
    },
    generation: {
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      mastraRunId: options.mastraRunId,
    },
  }
}

export async function embedPlannedExperience(
  planned: PlannedRun,
  options: ExperienceEmbeddingWorkflowOptions = {},
): Promise<EmbeddedRun> {
  const providerConfig = getExperienceEmbeddingProviderConfig()
  const result = await retryOperation(
    async () => {
      const rawResult = options.embeddingRequester
        ? await options.embeddingRequester([planned.source.text], {
            expectedDimensions: EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS,
            context: "Experience embedding",
            itemLabel: "experience source",
          })
        : await requestEmbeddingVectors([planned.source.text], {
            apiKey: options.apiKey ?? providerConfig.apiKey,
            baseUrl: options.embeddingsBaseUrl ?? providerConfig.baseUrl,
            model: planned.model.name,
            provider: planned.model.provider,
            expectedDimensions: EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS,
            expectedNativeDimensions: providerConfig.expectedNativeDimensions,
            truncateToDimensions: providerConfig.truncateToDimensions,
            transformVersion: providerConfig.transformVersion,
            userAgent: providerConfig.userAgent,
            context: "Experience embedding",
            itemLabel: "experience source",
            timeoutMs: options.timeoutMs ?? providerConfig.timeoutMs,
            fetchImpl: options.fetchImpl,
          })
      return validateEmbeddingProviderResult(rawResult, 1, {
        expectedDimensions: EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS,
        context: "Experience embedding",
        itemLabel: "experience source",
      })
    },
    (_value, error) =>
      error != null && failureFromEmbeddingError(error).retryable,
  )

  return {
    ...planned,
    embedding: result.embeddings[0]!,
    dimensions: EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS,
    nativeDimensions: result.nativeDimensions,
    transformVersion: result.transformVersion,
    providerTokenCount: result.tokenCount,
  }
}

function toAdminPayload(
  embedded: EmbeddedRun,
): AdminExperienceEmbeddingIngestPayload {
  return {
    target: embedded.target,
    source: {
      contentHash: embedded.source.contentHash,
      summary: embedded.source.summary,
    },
    model: {
      name: embedded.model.name,
      provider: embedded.model.provider,
      dimensions: embedded.dimensions,
      ...(embedded.nativeDimensions
        ? { nativeDimensions: embedded.nativeDimensions }
        : {}),
      ...(embedded.transformVersion
        ? { transformVersion: embedded.transformVersion }
        : {}),
    },
    generation: {
      mode: embedded.mode as ExperienceEmbeddingGenerationMode,
      generatedAt: embedded.generation.generatedAt,
      mastraRunId: embedded.generation.mastraRunId,
    },
    embedding: embedded.embedding,
  }
}

function successFromAdminResult(
  embedded: EmbeddedRun,
  result: AdminExperienceEmbeddingIngestResult,
): ExperienceEmbeddingWorkflowResult {
  if (result.status === "rejected") {
    return failure("admin_ingest_rejected", {
      retryable: false,
      adminStatus: result.status,
      adminReason: result.reason,
    })
  }

  return {
    ok: true,
    status: result.status,
    target: result.target,
    providerTokens: embedded.providerTokenCount,
    model: result.model,
    provider: embedded.model.provider,
    dimensions: result.dimensions,
    nativeDimensions: embedded.nativeDimensions,
    transformVersion: embedded.transformVersion,
    mastraRunId: embedded.generation.mastraRunId,
    sourceContentHash: embedded.source.contentHash,
  }
}

export async function submitExperienceEmbeddingRun(
  embedded: EmbeddedRun,
  options: ExperienceEmbeddingWorkflowOptions = {},
): Promise<ExperienceEmbeddingWorkflowResult> {
  const payload = toAdminPayload(embedded)
  const result = await retryOperation(
    () =>
      options.adminIngestClient
        ? options.adminIngestClient(payload)
        : callAdminExperienceIngest({
            ingestUrl: options.ingestUrl ?? env.ADMIN_EXPERIENCE_INGEST_URL,
            bearer:
              options.adminBearer ?? env.ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY,
            payload,
            timeoutMs: options.timeoutMs,
            fetchImpl: options.fetchImpl,
          }),
    (value) => value?.ok === false && value.retryable,
  )

  if (result.ok) {
    return successFromAdminResult(embedded, result.result)
  }
  if (result.reason === "config_missing") {
    return failure("admin_config_missing", {
      retryable: false,
    })
  }
  if (result.reason === "auth_failed") {
    return failure("admin_auth_failed", {
      retryable: false,
    })
  }
  if (result.reason === "rejected") {
    return failure("admin_ingest_rejected", {
      retryable: false,
      adminStatus: result.result?.status ?? String(result.status ?? ""),
      adminReason: result.result?.reason ?? result.adminReason,
    })
  }
  if (
    result.status != null &&
    result.status >= 400 &&
    result.status < 500 &&
    result.status !== 429
  ) {
    return failure("admin_ingest_rejected", {
      retryable: false,
      adminStatus: String(result.status),
      adminReason: result.adminReason,
    })
  }
  return failure("admin_ingest_failed", {
    retryable: result.retryable,
    adminStatus: result.status == null ? undefined : String(result.status),
    adminReason: result.adminReason,
  })
}

export async function runExperienceEmbeddingWorkflow(
  rawInput: unknown,
  options: ExperienceEmbeddingWorkflowOptions = {},
): Promise<ExperienceEmbeddingWorkflowResult> {
  const mastraRunId = options.runId ?? randomUUID()
  let planned: PlannedRun
  try {
    planned = planExperienceEmbeddingRun(rawInput, {
      mastraRunId,
      generatedAt: options.generatedAt,
    })
  } catch {
    return failure("invalid_input", { retryable: false })
  }

  let embedded: EmbeddedRun
  try {
    embedded = await embedPlannedExperience(planned, options)
  } catch (error) {
    return failureFromEmbeddingError(error)
  }

  return submitExperienceEmbeddingRun(embedded, options)
}

const planStep = createStep({
  id: "validate-and-plan-experience-embedding",
  description: "Validate experience source data and summarize the run.",
  inputSchema: z.unknown(),
  outputSchema: PlannedRunStepOutputSchema,
  execute: async ({ inputData, runId }) => {
    try {
      const planned = planExperienceEmbeddingRun(inputData, {
        mastraRunId: runId,
      })
      return { ok: true, summary: summarizePlannedRun(planned) } as const
    } catch {
      throwWorkflowFailure(failure("invalid_input", { retryable: false }))
    }
  },
})

function replanFromStepSummary(
  rawInput: unknown,
  options: { mastraRunId: string; generatedAt?: string },
): PlannedRun {
  return planExperienceEmbeddingRun(rawInput, options)
}

const embedExperienceStep = createStep({
  id: "embed-experience-source",
  description:
    "Generate the experience vector and retain only a scrubbed summary.",
  inputSchema: PlannedRunStepOutputSchema,
  outputSchema: EmbeddedRunStepOutputSchema,
  execute: async ({ inputData, getInitData, runId }) => {
    if (!inputData.ok) throwWorkflowFailure(inputData)
    let planned: PlannedRun
    try {
      planned = replanFromStepSummary(getInitData<unknown>(), {
        mastraRunId: runId,
      })
    } catch {
      throwWorkflowFailure(
        failure("invalid_input", {
          retryable: false,
        }),
      )
    }

    let embedded: EmbeddedRun
    try {
      embedded = await embedPlannedExperience(planned)
    } catch (error) {
      throwWorkflowFailure(failureFromEmbeddingError(error))
    }

    embeddedRunByMastraRunId.set(planned.generation.mastraRunId, embedded)
    return { ok: true, ...summarizeEmbeddedRun(embedded) } as const
  },
})

const ingestExperienceStep = createStep({
  id: "ingest-experience-embedding",
  description: "Submit the experience vector to Admin ingest.",
  inputSchema: EmbeddedRunStepOutputSchema,
  outputSchema: ExperienceEmbeddingWorkflowOutputSchema,
  execute: async ({ inputData, getInitData, runId }) => {
    if (!inputData.ok) throwWorkflowFailure(inputData)

    let embedded = embeddedRunByMastraRunId.get(runId)
    if (!embedded) {
      let planned: PlannedRun
      try {
        planned = replanFromStepSummary(getInitData<unknown>(), {
          mastraRunId: runId,
        })
      } catch {
        throwWorkflowFailure(
          failure("invalid_input", {
            retryable: false,
          }),
        )
      }

      try {
        embedded = await embedPlannedExperience(planned)
      } catch (error) {
        throwWorkflowFailure(failureFromEmbeddingError(error))
      }
    }

    try {
      const result = await submitExperienceEmbeddingRun(embedded)
      if (!result.ok) throwWorkflowFailure(result)
      return result
    } finally {
      embeddedRunByMastraRunId.delete(runId)
    }
  },
})

export const experienceEmbeddingWorkflow = createWorkflow({
  id: "experience-embedding",
  description:
    "Generate an ExperienceLocale embedding and store it through Admin ingest.",
  inputSchema: z.unknown(),
  outputSchema: ExperienceEmbeddingWorkflowOutputSchema,
})
  .then(planStep)
  .then(embedExperienceStep)
  .then(ingestExperienceStep)
  .commit()

export async function launchExperienceEmbeddingWorkflow(
  rawInput: unknown,
  options: ExperienceEmbeddingWorkflowOptions = {},
): Promise<ExperienceEmbeddingWorkflowResult> {
  const runId = options.runId ?? randomUUID()
  const run = await experienceEmbeddingWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: rawInput })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ??
      failure("admin_ingest_failed", { retryable: true })
    )
  }
  if (result.status === "success") return result.result
  return (
    workflowFailureFromRunResult(result) ??
    failure("admin_ingest_failed", { retryable: true })
  )
}

function routeStatusForResult(result: ExperienceEmbeddingWorkflowResult) {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "admin_ingest_rejected") {
    const adminStatus = Number(result.adminStatus)
    if (adminStatus >= 400 && adminStatus < 500) return adminStatus
    return 409
  }
  if (
    result.reason === "provider_config_missing" ||
    result.reason === "admin_config_missing"
  ) {
    return 503
  }
  return 502
}

export async function handleExperienceEmbeddingRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchExperienceEmbeddingWorkflow,
}: RouteHandlerInput): Promise<ExperienceEmbeddingRouteOutcome> {
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
      ? failure("invalid_input", { retryable: false })
      : await launch(body, { runId })

  return {
    status: routeStatusForResult(result),
    body: { result },
  }
}

export const _internals = {
  sha256Text,
  retryOperation,
  summarizePlannedRun,
  toAdminPayload,
  workflowFailureFromRunResult,
}
