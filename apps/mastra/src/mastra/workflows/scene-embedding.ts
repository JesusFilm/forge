import { createHash, randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import {
  callAdminSceneIngest,
  type AdminSceneEmbeddingIngestPayload,
  type AdminSceneEmbeddingIngestResult,
  type AdminSceneIngestClientResult,
  type SceneEmbeddingGenerationMode,
} from "../../services/admin-scene-ingest-client"
import {
  EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
  EmbeddingProviderError,
  requestEmbeddingVectors,
  validateEmbeddingProviderResult,
  type EmbeddingProviderResult,
} from "../../services/embedding-provider"
import { env, getSceneEmbeddingProviderConfig } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"

const SOURCE_ARTIFACT_VERSION = "manager-scene-analysis-v1"
const WORKFLOW_FAILURE_ERROR_PREFIX = "SCENE_EMBEDDING_WORKFLOW_FAILED:"

const GenerationModeSchema = z
  .enum(["idempotent", "repair", "force", "model-upgrade"])
  .default("idempotent")

const AdminTargetSchema = z
  .object({
    videoId: z.string().min(1),
    videoEditionId: z.string().min(1),
    coreId: z.string().min(1).optional(),
  })
  .strict()

const TargetSchema = z
  .object({
    admin: AdminTargetSchema,
  })
  .strict()

const SceneSourceSchema = z
  .object({
    sceneIndex: z.number().int().nonnegative(),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nonnegative().optional(),
    chapterTitle: z.string().min(1).optional(),
    description: z.string(),
    themes: z.array(z.string()).optional(),
    bibleVerses: z.array(z.string()).optional(),
    demographics: z.array(z.string()).optional(),
    spiritualContext: z.array(z.string()).optional(),
  })
  .strict()

const ModelOptionsSchema = z
  .object({
    name: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
  })
  .strict()

export const SceneEmbeddingWorkflowInputSchema = z
  .object({
    target: TargetSchema,
    locale: z.string().min(1),
    sceneAnalysis: z
      .object({
        scenes: z.array(SceneSourceSchema).min(1),
        artifactKey: z.string().min(1),
        artifactVersion: z.string().min(1).optional(),
        provider: z.string().min(1),
        generatedAt: z.string().min(1).optional(),
      })
      .strict(),
    mode: GenerationModeSchema,
    model: ModelOptionsSchema.optional(),
  })
  .strict()

const PlannedRunSummarySchema = z
  .object({
    target: TargetSchema,
    locale: z.string().min(1),
    mode: GenerationModeSchema,
    source: z
      .object({
        artifactKey: z.string().min(1),
        artifactVersion: z.string().min(1),
        provider: z.string().min(1),
        generatedAt: z.string().min(1).optional(),
        contentHash: z.string().min(1),
        sceneCount: z.number().int().positive(),
        sourceTextLength: z.number().int().nonnegative(),
        sceneIndexes: z.array(z.number().int().nonnegative()),
      })
      .strict(),
    model: z
      .object({
        name: z.string().min(1),
        provider: z.string().min(1),
      })
      .strict(),
    generation: z
      .object({
        generatedAt: z.string().min(1),
        mastraRunId: z.string().min(1),
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
        videoId: z.string(),
        videoEditionId: z.string(),
        coreId: z.string(),
        locale: z.string(),
      })
      .strict(),
    scenes: z.number().int().nonnegative(),
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
    mastraRunId: z.string(),
    adminStatus: z.string().optional(),
    adminReason: z.string().optional(),
  })
  .strict()

export const SceneEmbeddingWorkflowOutputSchema = z.discriminatedUnion("ok", [
  WorkflowSuccessSchema,
  WorkflowFailureSchema,
])

export type SceneEmbeddingWorkflowInput = z.infer<
  typeof SceneEmbeddingWorkflowInputSchema
>
type SourceScene = z.infer<typeof SceneSourceSchema>
type PlannedScene = SourceScene & {
  sourceText: string
}
type PlannedRun = {
  target: SceneEmbeddingWorkflowInput["target"]
  locale: string
  mode: z.infer<typeof GenerationModeSchema>
  source: {
    scenes: PlannedScene[]
    artifactKey: string
    artifactVersion: string
    provider: string
    generatedAt?: string
    contentHash: string
  }
  model: {
    name: string
    provider: string
  }
  generation: {
    generatedAt: string
    mastraRunId: string
  }
}
type EmbeddedScene = PlannedScene & { embedding: number[] }
type EmbeddedRun = Omit<PlannedRun, "source"> & {
  source: Omit<PlannedRun["source"], "scenes"> & { scenes: EmbeddedScene[] }
  dimensions: number
  nativeDimensions?: number
  transformVersion?: string
  providerTokenCount: number
}
export type SceneEmbeddingWorkflowResult = z.infer<
  typeof SceneEmbeddingWorkflowOutputSchema
>
type SceneEmbeddingWorkflowFailure = z.infer<typeof WorkflowFailureSchema>
type SceneEmbeddingWorkflowFailureReason =
  SceneEmbeddingWorkflowFailure["reason"]

const PlannedRunStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      summary: PlannedRunSummarySchema,
    })
    .strict(),
  WorkflowFailureSchema,
])

const EmbeddedRunStepOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      summary: PlannedRunSummarySchema,
      vectors: z
        .object({
          dimensions: z.number().int().positive(),
          providerTokenCount: z.number().int().nonnegative(),
          sceneCount: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  WorkflowFailureSchema,
])

export type SceneEmbeddingWorkflowOptions = {
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
    payload: AdminSceneEmbeddingIngestPayload,
  ) => Promise<AdminSceneIngestClientResult>
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<SceneEmbeddingWorkflowResult>
}

export type SceneEmbeddingRouteOutcome = {
  status: number
  body: { result?: SceneEmbeddingWorkflowResult; error?: string }
}

const embeddedRunByMastraRunId = new Map<string, EmbeddedRun>()

const MAX_RETRYABLE_ATTEMPTS = 3

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`
}

function sourceContentHash(scenes: readonly PlannedScene[], locale: string) {
  return sha256Json({
    locale,
    scenes: scenes.map((scene) => ({
      sceneIndex: scene.sceneIndex,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds ?? null,
      sourceText: scene.sourceText,
      description: scene.description,
      themes: scene.themes ?? [],
      bibleVerses: scene.bibleVerses ?? [],
      demographics: scene.demographics ?? [],
      spiritualContext: scene.spiritualContext ?? [],
    })),
  })
}

function assertSceneInput(scenes: readonly SourceScene[]): PlannedScene[] {
  const seen = new Set<number>()
  const planned: PlannedScene[] = []
  for (const scene of scenes) {
    if (seen.has(scene.sceneIndex)) {
      throw new Error("duplicate sceneIndex")
    }
    seen.add(scene.sceneIndex)
    if (scene.endSeconds != null && scene.endSeconds < scene.startSeconds) {
      throw new Error("invalid scene timecodes")
    }
    const sourceText = scene.description.trim()
    if (!sourceText) throw new Error("scene description is required")
    planned.push({
      ...scene,
      sourceText,
      description: sourceText,
    })
  }
  planned.sort((a, b) => a.sceneIndex - b.sceneIndex)
  for (let index = 0; index < planned.length; index += 1) {
    if (planned[index]!.sceneIndex !== index) {
      throw new Error("non-contiguous sceneIndex")
    }
  }
  return planned
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
    locale: planned.locale,
    mode: planned.mode,
    source: {
      artifactKey: planned.source.artifactKey,
      artifactVersion: planned.source.artifactVersion,
      provider: planned.source.provider,
      generatedAt: planned.source.generatedAt,
      contentHash: planned.source.contentHash,
      sceneCount: planned.source.scenes.length,
      sourceTextLength: planned.source.scenes.reduce(
        (sum, scene) => sum + scene.sourceText.length,
        0,
      ),
      sceneIndexes: planned.source.scenes.map((scene) => scene.sceneIndex),
    },
    model: planned.model,
    generation: planned.generation,
  }
}

function summarizeEmbeddedRun(embedded: EmbeddedRun) {
  return {
    summary: summarizePlannedRun(embedded),
    vectors: {
      dimensions: embedded.dimensions,
      providerTokenCount: embedded.providerTokenCount,
      sceneCount: embedded.source.scenes.length,
    },
  }
}

function failure(
  reason: SceneEmbeddingWorkflowFailureReason,
  options: {
    mastraRunId: string
    retryable: boolean
    adminStatus?: string
    adminReason?: string
  },
): SceneEmbeddingWorkflowFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    mastraRunId: options.mastraRunId,
    adminStatus: options.adminStatus,
    adminReason: options.adminReason,
  }
}

class SceneEmbeddingWorkflowFailureError extends Error {
  constructor(readonly result: SceneEmbeddingWorkflowFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "SceneEmbeddingWorkflowFailureError"
  }
}

function throwWorkflowFailure(result: SceneEmbeddingWorkflowFailure): never {
  throw new SceneEmbeddingWorkflowFailureError(result)
}

function workflowFailureFromUnknown(
  value: unknown,
): SceneEmbeddingWorkflowFailure | null {
  if (value instanceof SceneEmbeddingWorkflowFailureError) {
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
): SceneEmbeddingWorkflowFailure | null {
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
  mastraRunId: string,
): SceneEmbeddingWorkflowFailure {
  if (error instanceof EmbeddingProviderError) {
    if (error.code === "config_missing") {
      return failure("provider_config_missing", {
        mastraRunId,
        retryable: false,
      })
    }
    if (error.code === "auth_failed") {
      return failure("provider_auth_failed", {
        mastraRunId,
        retryable: false,
      })
    }
    if (error.code === "dimension_mismatch") {
      return failure("provider_dimension_mismatch", {
        mastraRunId,
        retryable: false,
      })
    }
    return failure("provider_failed", {
      mastraRunId,
      retryable: error.retryable,
    })
  }

  return failure("provider_failed", { mastraRunId, retryable: true })
}

export function planSceneEmbeddingRun(
  rawInput: unknown,
  options: { mastraRunId: string; generatedAt?: string } = {
    mastraRunId: randomUUID(),
  },
): PlannedRun {
  const input = SceneEmbeddingWorkflowInputSchema.parse(rawInput)
  const providerConfig = getSceneEmbeddingProviderConfig()
  const scenes = assertSceneInput(input.sceneAnalysis.scenes)
  return {
    target: input.target,
    locale: input.locale,
    mode: input.mode,
    source: {
      scenes,
      artifactKey: input.sceneAnalysis.artifactKey,
      artifactVersion:
        input.sceneAnalysis.artifactVersion ?? SOURCE_ARTIFACT_VERSION,
      provider: input.sceneAnalysis.provider,
      generatedAt: input.sceneAnalysis.generatedAt,
      contentHash: sourceContentHash(scenes, input.locale),
    },
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

export async function embedPlannedScenes(
  planned: PlannedRun,
  options: SceneEmbeddingWorkflowOptions = {},
): Promise<EmbeddedRun> {
  const providerConfig = getSceneEmbeddingProviderConfig()
  const input = planned.source.scenes.map((scene) => scene.sourceText)
  const result = await retryOperation(
    async () => {
      const rawResult = options.embeddingRequester
        ? await options.embeddingRequester(input, {
            expectedDimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
            context: "Scene embedding batch",
            itemLabel: "scene descriptions",
          })
        : await requestEmbeddingVectors(input, {
            apiKey: options.apiKey ?? providerConfig.apiKey,
            baseUrl: options.embeddingsBaseUrl ?? providerConfig.baseUrl,
            model: planned.model.name,
            provider: planned.model.provider,
            expectedDimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
            expectedNativeDimensions: providerConfig.expectedNativeDimensions,
            truncateToDimensions: providerConfig.truncateToDimensions,
            transformVersion: providerConfig.transformVersion,
            userAgent: providerConfig.userAgent,
            context: "Scene embedding batch",
            itemLabel: "scene descriptions",
            timeoutMs: options.timeoutMs ?? providerConfig.timeoutMs,
            fetchImpl: options.fetchImpl,
          })
      return validateEmbeddingProviderResult(rawResult, input.length, {
        expectedDimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
        context: "Scene embedding batch",
        itemLabel: "scene descriptions",
      })
    },
    (_value, error) =>
      error != null &&
      failureFromEmbeddingError(error, planned.generation.mastraRunId)
        .retryable,
  )

  return {
    ...planned,
    source: {
      ...planned.source,
      scenes: planned.source.scenes.map((scene, index) => ({
        ...scene,
        embedding: result.embeddings[index]!,
      })),
    },
    dimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
    nativeDimensions: result.nativeDimensions,
    transformVersion: result.transformVersion,
    providerTokenCount: result.tokenCount,
  }
}

function toAdminPayload(
  embedded: EmbeddedRun,
): AdminSceneEmbeddingIngestPayload {
  return {
    target: embedded.target,
    locale: embedded.locale,
    source: {
      artifactKey: embedded.source.artifactKey,
      artifactVersion: embedded.source.artifactVersion,
      provider: embedded.source.provider,
      generatedAt: embedded.source.generatedAt,
      contentHash: embedded.source.contentHash,
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
      mode: embedded.mode as SceneEmbeddingGenerationMode,
      generatedAt: embedded.generation.generatedAt,
      mastraRunId: embedded.generation.mastraRunId,
    },
    scenes: embedded.source.scenes,
  }
}

function successFromAdminResult(
  embedded: EmbeddedRun,
  result: AdminSceneEmbeddingIngestResult,
): SceneEmbeddingWorkflowResult {
  if (result.status === "rejected") {
    return failure("admin_ingest_rejected", {
      mastraRunId: embedded.generation.mastraRunId,
      retryable: false,
      adminStatus: result.status,
      adminReason: result.reason,
    })
  }

  return {
    ok: true,
    status: result.status,
    target: result.target,
    scenes: result.scenes,
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

export async function submitSceneEmbeddingRun(
  embedded: EmbeddedRun,
  options: SceneEmbeddingWorkflowOptions = {},
): Promise<SceneEmbeddingWorkflowResult> {
  const payload = toAdminPayload(embedded)
  const result = await retryOperation(
    () =>
      options.adminIngestClient
        ? options.adminIngestClient(payload)
        : callAdminSceneIngest({
            ingestUrl: options.ingestUrl ?? env.ADMIN_SCENE_INGEST_URL,
            bearer:
              options.adminBearer ?? env.ADMIN_MASTRA_SCENE_INGEST_API_KEY,
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
      mastraRunId: embedded.generation.mastraRunId,
      retryable: false,
    })
  }
  if (result.reason === "auth_failed") {
    return failure("admin_auth_failed", {
      mastraRunId: embedded.generation.mastraRunId,
      retryable: false,
    })
  }
  if (result.reason === "rejected") {
    return failure("admin_ingest_rejected", {
      mastraRunId: embedded.generation.mastraRunId,
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
      mastraRunId: embedded.generation.mastraRunId,
      retryable: false,
      adminStatus: String(result.status),
      adminReason: result.adminReason,
    })
  }
  return failure("admin_ingest_failed", {
    mastraRunId: embedded.generation.mastraRunId,
    retryable: result.retryable,
    adminStatus: result.status == null ? undefined : String(result.status),
    adminReason: result.adminReason,
  })
}

export async function runSceneEmbeddingWorkflow(
  rawInput: unknown,
  options: SceneEmbeddingWorkflowOptions = {},
): Promise<SceneEmbeddingWorkflowResult> {
  const mastraRunId = options.runId ?? randomUUID()
  let planned: PlannedRun
  try {
    planned = planSceneEmbeddingRun(rawInput, {
      mastraRunId,
      generatedAt: options.generatedAt,
    })
  } catch {
    return failure("invalid_input", { mastraRunId, retryable: false })
  }

  let embedded: EmbeddedRun
  try {
    embedded = await embedPlannedScenes(planned, options)
  } catch (error) {
    return failureFromEmbeddingError(error, mastraRunId)
  }

  return submitSceneEmbeddingRun(embedded, options)
}

const planStep = createStep({
  id: "validate-and-plan-scene-embedding",
  description: "Validate scene source data and summarize the scene run.",
  inputSchema: SceneEmbeddingWorkflowInputSchema,
  outputSchema: PlannedRunStepOutputSchema,
  execute: async ({ inputData, runId }) => {
    try {
      const planned = planSceneEmbeddingRun(inputData, { mastraRunId: runId })
      return { ok: true, summary: summarizePlannedRun(planned) } as const
    } catch {
      throwWorkflowFailure(
        failure("invalid_input", { mastraRunId: runId, retryable: false }),
      )
    }
  },
})

function replanFromStepSummary(
  rawInput: unknown,
  summary: z.infer<typeof PlannedRunSummarySchema>,
): PlannedRun {
  return planSceneEmbeddingRun(rawInput, {
    mastraRunId: summary.generation.mastraRunId,
    generatedAt: summary.generation.generatedAt,
  })
}

const embedScenesStep = createStep({
  id: "embed-scene-descriptions",
  description: "Generate scene vectors and retain only a scrubbed summary.",
  inputSchema: PlannedRunStepOutputSchema,
  outputSchema: EmbeddedRunStepOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) throwWorkflowFailure(inputData)
    let planned: PlannedRun
    try {
      planned = replanFromStepSummary(getInitData<unknown>(), inputData.summary)
    } catch {
      throwWorkflowFailure(
        failure("invalid_input", {
          mastraRunId: inputData.summary.generation.mastraRunId,
          retryable: false,
        }),
      )
    }

    let embedded: EmbeddedRun
    try {
      embedded = await embedPlannedScenes(planned)
    } catch (error) {
      throwWorkflowFailure(
        failureFromEmbeddingError(error, planned.generation.mastraRunId),
      )
    }

    embeddedRunByMastraRunId.set(planned.generation.mastraRunId, embedded)
    return {
      ok: true,
      ...summarizeEmbeddedRun(embedded),
    } as const
  },
})

const ingestScenesStep = createStep({
  id: "ingest-scene-embeddings",
  description: "Submit scene vectors to Admin ingest.",
  inputSchema: EmbeddedRunStepOutputSchema,
  outputSchema: SceneEmbeddingWorkflowOutputSchema,
  execute: async ({ inputData, getInitData }) => {
    if (!inputData.ok) throwWorkflowFailure(inputData)

    let embedded = embeddedRunByMastraRunId.get(
      inputData.summary.generation.mastraRunId,
    )
    if (!embedded) {
      let planned: PlannedRun
      try {
        planned = replanFromStepSummary(
          getInitData<unknown>(),
          inputData.summary,
        )
      } catch {
        throwWorkflowFailure(
          failure("invalid_input", {
            mastraRunId: inputData.summary.generation.mastraRunId,
            retryable: false,
          }),
        )
      }

      try {
        embedded = await embedPlannedScenes(planned)
      } catch (error) {
        throwWorkflowFailure(
          failureFromEmbeddingError(error, planned.generation.mastraRunId),
        )
      }
    }

    try {
      const result = await submitSceneEmbeddingRun(embedded)
      if (!result.ok) throwWorkflowFailure(result)
      return result
    } finally {
      embeddedRunByMastraRunId.delete(inputData.summary.generation.mastraRunId)
    }
  },
})

export const sceneEmbeddingWorkflow = createWorkflow({
  id: "scene-embedding",
  description:
    "Generate scene description embeddings and store them through Admin ingest.",
  inputSchema: SceneEmbeddingWorkflowInputSchema,
  outputSchema: SceneEmbeddingWorkflowOutputSchema,
})
  .then(planStep)
  .then(embedScenesStep)
  .then(ingestScenesStep)
  .commit()

export async function launchSceneEmbeddingWorkflow(
  rawInput: unknown,
  options: SceneEmbeddingWorkflowOptions = {},
): Promise<SceneEmbeddingWorkflowResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = SceneEmbeddingWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", { mastraRunId: runId, retryable: false })
  }

  const run = await sceneEmbeddingWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: parsed.data })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ??
      failure("admin_ingest_failed", { mastraRunId: runId, retryable: true })
    )
  }
  if (result.status === "success") return result.result
  return (
    workflowFailureFromRunResult(result) ??
    failure("admin_ingest_failed", { mastraRunId: runId, retryable: true })
  )
}

function routeStatusForResult(result: SceneEmbeddingWorkflowResult) {
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

export async function handleSceneEmbeddingRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchSceneEmbeddingWorkflow,
}: RouteHandlerInput): Promise<SceneEmbeddingRouteOutcome> {
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
      ? failure("invalid_input", { mastraRunId: runId, retryable: false })
      : await launch(body, { runId })

  return {
    status: routeStatusForResult(result),
    body: { result },
  }
}

export const _internals = {
  sourceContentHash,
  retryOperation,
  summarizePlannedRun,
  toAdminPayload,
  workflowFailureFromRunResult,
}
