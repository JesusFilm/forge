import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { env } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"

export const SUBTITLE_ENRICHMENT_WORKFLOW_ID = "subtitle-enrichment"

const requestedBySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("manager_user"),
      id: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("service"),
      id: z.string().min(1),
    })
    .strict(),
])

const materializationSchema = z
  .object({
    mode: z.enum(["direct_mux_asset_reuse", "snapshot_to_stage_clone"]),
    targetEnvironment: z.enum(["mux-production", "mux-stage"]),
  })
  .strict()

export const SubtitleEnrichmentRunRequestSchema = z
  .object({
    jobId: z.string().min(1),
    videoDocumentId: z.string().min(1).optional(),
    assetId: z.string().min(1),
    muxAssetId: z.string().min(1),
    muxPlaybackId: z.string().min(1).optional(),
    sourceLanguage: z.string().min(1),
    targetLanguage: z.string().min(1),
    materialization: materializationSchema,
    requestedTranscriptionProvider: z
      .enum(["automatic", "mux", "elevenlabs"])
      .optional(),
    initialArtifacts: z.record(z.string(), z.unknown()).optional(),
    requestedBy: requestedBySchema,
    idempotencyKey: z.string().min(1),
  })
  .strict()

const subtitleRunSuccessStatusSchema = z.enum(["queued", "running"])

const subtitleEnrichmentFailureCodeSchema = z.enum([
  "unauthorized",
  "invalid_request",
  "job_not_approved",
  "idempotency_conflict",
  "manager_unavailable",
  "mastra_runtime_error",
])

export const SubtitleEnrichmentRunResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      mastraRunId: z.string().min(1),
      managerJobId: z.string().min(1),
      status: subtitleRunSuccessStatusSchema,
      summary: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: subtitleEnrichmentFailureCodeSchema,
      message: z.string().min(1),
    })
    .strict(),
])

type SubtitleEnrichmentFailureCode = z.infer<
  typeof subtitleEnrichmentFailureCodeSchema
>

export type SubtitleEnrichmentRunRequest = z.infer<
  typeof SubtitleEnrichmentRunRequestSchema
>

export type SubtitleEnrichmentRunResponse = z.infer<
  typeof SubtitleEnrichmentRunResponseSchema
>

type SubtitleEnrichmentWorkflowDependencies = {
  runId?: string
  managerBaseUrl?: string
  managerMastraApiKey?: string
  requestTimeoutMs?: number
  fetcher?: typeof fetch
}

type RouteHandlerInput = {
  authHeader?: string
  serviceKeys: string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: SubtitleEnrichmentRunRequest,
    dependencies?: SubtitleEnrichmentWorkflowDependencies,
  ) => Promise<SubtitleEnrichmentRunResponse>
}

type SubtitleEnrichmentRouteOutcome = {
  status: number
  body: unknown
}

type IdempotencyRecord = {
  fingerprint: string
  result: SubtitleEnrichmentRunResponse
}

const runsByIdempotencyKey = new Map<string, IdempotencyRecord>()

function failure(
  code: SubtitleEnrichmentFailureCode,
  message: string,
): SubtitleEnrichmentRunResponse {
  return {
    ok: false,
    code,
    message,
  }
}

export function subtitleEnrichmentRunId(idempotencyKey: string): string {
  return `subtitle-enrichment:${idempotencyKey}`
}

export async function runSubtitleEnrichmentWorkflow(
  input: SubtitleEnrichmentRunRequest,
  dependencies: SubtitleEnrichmentWorkflowDependencies = {},
): Promise<SubtitleEnrichmentRunResponse> {
  const mastraRunId =
    dependencies.runId ?? subtitleEnrichmentRunId(input.idempotencyKey)
  const { managerBaseUrl, managerMastraApiKey } = dependencies

  if (managerBaseUrl && managerMastraApiKey) {
    try {
      await emitPrototypeSubtitleEvents(input, mastraRunId, {
        ...dependencies,
        managerBaseUrl,
        managerMastraApiKey,
      })
    } catch {
      return failure(
        "manager_unavailable",
        "Manager subtitle event callback was unavailable.",
      )
    }
  }

  return {
    ok: true,
    mastraRunId,
    managerJobId: input.jobId,
    status: "queued",
    summary: "Subtitle enrichment run queued.",
  }
}

const queueSubtitleRunStep = createStep({
  id: "queue-subtitle-enrichment-run",
  description:
    "Queues an approved Manager subtitle enrichment job for Mastra execution.",
  inputSchema: SubtitleEnrichmentRunRequestSchema,
  outputSchema: SubtitleEnrichmentRunResponseSchema,
  execute: async ({ inputData, runId }) =>
    runSubtitleEnrichmentWorkflow(inputData, {
      runId,
      managerBaseUrl: env.MANAGER_BASE_URL,
      managerMastraApiKey: env.MANAGER_MASTRA_API_KEY,
      requestTimeoutMs: env.MASTRA_SUBTITLE_CALLBACK_TIMEOUT_MS,
    }),
})

export const subtitleEnrichmentWorkflow = createWorkflow({
  id: SUBTITLE_ENRICHMENT_WORKFLOW_ID,
  description:
    "Run the Manager-approved subtitle enrichment handoff and publish progress events back to Manager.",
  inputSchema: SubtitleEnrichmentRunRequestSchema,
  outputSchema: SubtitleEnrichmentRunResponseSchema,
})
  .then(queueSubtitleRunStep)
  .commit()

export async function launchSubtitleEnrichmentWorkflow(
  rawInput: unknown,
  dependencies: SubtitleEnrichmentWorkflowDependencies = {},
): Promise<SubtitleEnrichmentRunResponse> {
  const parsed = SubtitleEnrichmentRunRequestSchema.safeParse(rawInput)
  const runId =
    dependencies.runId ??
    (parsed.success
      ? subtitleEnrichmentRunId(parsed.data.idempotencyKey)
      : randomUUID())
  if (!parsed.success) {
    return failure(
      "invalid_request",
      "Request must match the subtitle enrichment run contract.",
    )
  }

  const run = await subtitleEnrichmentWorkflow.createRun({ runId })
  const result = await run
    .start({ inputData: parsed.data })
    .catch(() => undefined)

  if (result?.status === "success") {
    return result.result
  }

  return failure(
    "mastra_runtime_error",
    "Failed to start subtitle enrichment workflow.",
  )
}

function responseStatus(result: SubtitleEnrichmentRunResponse): number {
  if (result.ok) return 202

  switch (result.code) {
    case "unauthorized":
      return 401
    case "invalid_request":
    case "job_not_approved":
      return 400
    case "idempotency_conflict":
      return 409
    case "manager_unavailable":
    case "mastra_runtime_error":
      return 502
  }
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

  const body = await readJson().catch(() => undefined)
  const parsed = SubtitleEnrichmentRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    const result = failure(
      "invalid_request",
      "Request must match the subtitle enrichment run contract.",
    )
    return {
      status: responseStatus(result),
      body: { result },
    }
  }

  const fingerprint = stableFingerprint(parsed.data)
  const existing = runsByIdempotencyKey.get(parsed.data.idempotencyKey)
  if (existing && existing.fingerprint !== fingerprint) {
    const result = failure(
      "idempotency_conflict",
      "Idempotency key already belongs to a different subtitle enrichment request.",
    )
    return {
      status: responseStatus(result),
      body: { result },
    }
  }

  if (existing) {
    return {
      status: responseStatus(existing.result),
      body: { result: existing.result },
    }
  }

  const result = await launch(parsed.data, {
    runId: subtitleEnrichmentRunId(parsed.data.idempotencyKey),
  }).catch(() =>
    failure(
      "mastra_runtime_error",
      "Failed to start subtitle enrichment workflow.",
    ),
  )

  if (result.ok) {
    runsByIdempotencyKey.set(parsed.data.idempotencyKey, {
      fingerprint,
      result,
    })
  }

  return {
    status: responseStatus(result),
    body: { result },
  }
}

async function emitPrototypeSubtitleEvents(
  input: SubtitleEnrichmentRunRequest,
  mastraRunId: string,
  dependencies: Required<
    Pick<
      SubtitleEnrichmentWorkflowDependencies,
      "managerBaseUrl" | "managerMastraApiKey"
    >
  > &
    SubtitleEnrichmentWorkflowDependencies,
) {
  const fetcher = dependencies.fetcher ?? fetch
  const occurredAt = new Date().toISOString()
  const events = [
    { type: "workflow_started", sequence: 1 },
    { type: "step_started", step: "transcription", sequence: 2 },
    { type: "step_completed", step: "transcription", sequence: 3 },
    { type: "step_started", step: "translation", sequence: 4 },
    { type: "step_completed", step: "translation", sequence: 5 },
    { type: "step_started", step: "mux_upload", sequence: 6 },
    { type: "step_completed", step: "mux_upload", sequence: 7 },
    { type: "workflow_completed", sequence: 8 },
  ] as const

  for (const event of events) {
    const response = await fetcher(
      `${dependencies.managerBaseUrl.replace(/\/+$/, "")}/api/mastra/subtitle-enrichment-runs/${encodeURIComponent(mastraRunId)}/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${dependencies.managerMastraApiKey}`,
        },
        body: JSON.stringify({
          eventId: `${mastraRunId}:${event.sequence}`,
          runId: mastraRunId,
          jobId: input.jobId,
          idempotencyKey: input.idempotencyKey,
          sequence: event.sequence,
          occurredAt,
          type: event.type,
          ...("step" in event ? { step: event.step } : {}),
        }),
        signal: AbortSignal.timeout(dependencies.requestTimeoutMs ?? 60_000),
      },
    )

    if (!response.ok) {
      throw new Error(`Manager callback failed with ${response.status}`)
    }
  }
}

function stableFingerprint(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    )
  }

  return value
}

export const _internals = {
  clearIdempotencyCache: () => runsByIdempotencyKey.clear(),
  responseStatus,
  stableFingerprint,
}
