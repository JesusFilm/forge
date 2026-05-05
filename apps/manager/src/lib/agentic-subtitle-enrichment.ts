import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"
import {
  getJob,
  mergeArtifactEntries,
  mergeJobArtifacts,
  updateJob,
  updateStepStatus,
} from "@/lib/state"
import type {
  JobArtifactManifest,
  JobError,
  JobRecord,
  JobStatus,
  WorkflowStepName,
  StepStatus,
} from "@/types/job"
import { z } from "zod"

const DEFAULT_AGENTIC_FETCH_TIMEOUT_MS = 15_000

const workflowStepNameSchema = z.enum([
  "download_video",
  "transcription",
  "structured_transcript",
  "subtitle_post_process",
  "chapters",
  "metadata",
  "embeddings",
  "translation",
  "audio_cleanup",
  "voiceover",
  "artifact_upload",
  "mux_upload",
  "theology_validation_bible_quotes",
  "seo_improvements",
  "cms_notify",
])

const downloadableArtifactEntrySchema = z.object({
  kind: z.literal("downloadable"),
})

const metadataArtifactEntrySchema = z.object({
  kind: z.literal("metadata"),
  data: z.record(z.string(), z.unknown()),
})

const artifactManifestSchema = z.record(
  z.string(),
  z.union([downloadableArtifactEntrySchema, metadataArtifactEntrySchema]),
)

const agenticSubtitleRunSuccessSchema = z.object({
  ok: z.literal(true),
  agenticRunId: z.string().min(1),
  managerJobId: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed"]),
  summary: z.string().min(1).optional(),
  reportUrl: z.string().optional(),
})

const agenticSubtitleRunFailureSchema = z.object({
  ok: z.literal(false),
  code: z.string().min(1).default("agentic_error"),
  message: z.string().min(1).optional(),
  messages: z.array(z.string().min(1)).optional(),
})

const agenticSubtitleRunEnvelopeSchema = z.union([
  agenticSubtitleRunSuccessSchema,
  agenticSubtitleRunFailureSchema,
])

const subtitleEventBaseSchema = z.object({
  eventId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime().optional(),
  artifacts: artifactManifestSchema.optional(),
})

const subtitleWorkflowEventSchema = subtitleEventBaseSchema.extend({
  type: z.enum(["workflow_started", "workflow_completed", "workflow_failed"]),
  error: z.unknown().optional(),
})

const subtitleStepEventSchema = subtitleEventBaseSchema.extend({
  type: z.enum(["step_started", "step_completed", "step_failed"]),
  step: workflowStepNameSchema,
  error: z.unknown().optional(),
})

const subtitleEventSchema = z.union([
  subtitleWorkflowEventSchema,
  subtitleStepEventSchema,
])

export type AgenticSubtitleEnrichmentInput = {
  jobId: string
  assetId: string
  muxAssetId: string
  muxPlaybackId: string
  sourceLanguage: string
  targetLanguage: string
  materialization?: {
    mode: string
    targetEnvironment: "mux-stage" | "mux-production"
  }
  requestedTranscriptionProvider: "automatic" | "elevenlabs" | "mux"
  initialArtifacts?: JobArtifactManifest
  videoDocumentId?: string
  requestedBy?: {
    kind: "manager_user" | "service"
    id: string
  }
  idempotencyKey: string
}

export type AgenticSubtitleEnrichmentResult =
  | z.infer<typeof agenticSubtitleRunSuccessSchema>
  | {
      ok: false
      reason: "config_missing"
      messages: string[]
      retryable: false
    }
  | {
      ok: false
      reason: "network_error"
      messages: string[]
      retryable: true
    }
  | {
      ok: false
      reason: "parse_error"
      messages: string[]
      httpStatus: number
      retryable: true
    }
  | {
      ok: false
      reason: "contract_error"
      messages: string[]
      httpStatus: number
      retryable: false
    }
  | {
      ok: false
      reason: "upstream_error"
      code: string
      messages: string[]
      httpStatus: number
      retryable: false
    }

export type AgenticSubtitleEvent = z.infer<typeof subtitleEventSchema>

export type AgenticSubtitleEventResult = {
  ok: true
  deduped: boolean
}

const acceptedEventKeys = new Set<string>()
const lastSequenceByRunId = new Map<string, number>()
const CALLBACK_STATE_ARTIFACT_KEY = "agenticSubtitleCallbackState"
const MAX_PERSISTED_EVENT_IDS = 50

type PersistedCallbackState = {
  runId: string
  lastAcceptedSequence: number
  acceptedEventIds: string[]
  lastEventId: string
  lastEventType: AgenticSubtitleEvent["type"]
  updatedAt: string
  terminal?: {
    type: "workflow_completed" | "workflow_failed"
    at: string
  }
}

function eventDedupKey(event: Pick<AgenticSubtitleEvent, "eventId">) {
  return event.eventId
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim()
  }

  if (
    typeof error === "object" &&
    error != null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.trim().length > 0
  ) {
    return (error as { message: string }).message.trim()
  }

  return "Agentic subtitle enrichment failed."
}

function getTerminalTimestamp(event: AgenticSubtitleEvent): string {
  return event.occurredAt ?? new Date().toISOString()
}

export function isValidAgenticServiceRequest(request: Request): boolean {
  const apiKey = env.MANAGER_AGENTIC_API_KEY
  const authHeader = request.headers.get("authorization")
  if (!apiKey || !authHeader?.startsWith("Bearer ")) {
    return false
  }

  const token = authHeader.slice(7)
  const a = Buffer.from(token)
  const b = Buffer.from(apiKey)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function parseAgenticSubtitleEvent(input: unknown) {
  return subtitleEventSchema.safeParse(input)
}

async function mergeArtifactsIfPresent(
  jobId: string,
  artifacts: JobArtifactManifest | undefined,
  callbackStateArtifacts?: JobArtifactManifest,
) {
  const mergedArtifacts = mergeArtifactInputs(artifacts, callbackStateArtifacts)
  if (Object.keys(mergedArtifacts).length === 0) {
    return
  }

  await mergeJobArtifacts(jobId, mergedArtifacts)
}

function mergeArtifactInputs(
  left: JobArtifactManifest | undefined,
  right: JobArtifactManifest | undefined,
) {
  return mergeArtifactEntries(left ?? {}, right ?? {})
}

function readPersistedCallbackState(
  job: JobRecord,
): PersistedCallbackState | null {
  const entry = job.artifacts[CALLBACK_STATE_ARTIFACT_KEY]
  if (entry?.kind !== "metadata") {
    return null
  }

  const data = entry.data
  if (
    typeof data.runId !== "string" ||
    typeof data.lastAcceptedSequence !== "number" ||
    !Array.isArray(data.acceptedEventIds) ||
    typeof data.lastEventId !== "string" ||
    typeof data.lastEventType !== "string" ||
    typeof data.updatedAt !== "string"
  ) {
    return null
  }

  const terminal = readPersistedTerminalState(data.terminal)

  return {
    runId: data.runId,
    lastAcceptedSequence: data.lastAcceptedSequence,
    acceptedEventIds: data.acceptedEventIds.filter(
      (eventId): eventId is string => typeof eventId === "string",
    ),
    lastEventId: data.lastEventId,
    lastEventType: data.lastEventType as AgenticSubtitleEvent["type"],
    updatedAt: data.updatedAt,
    ...(terminal ? { terminal } : {}),
  }
}

function readPersistedTerminalState(
  value: unknown,
): PersistedCallbackState["terminal"] | undefined {
  if (typeof value !== "object" || value == null) {
    return undefined
  }

  const type = (value as { type?: unknown }).type
  const at = (value as { at?: unknown }).at
  if (
    (type === "workflow_completed" || type === "workflow_failed") &&
    typeof at === "string"
  ) {
    return { type, at }
  }

  return undefined
}

function buildCallbackStateArtifacts(
  event: AgenticSubtitleEvent,
  previousState: PersistedCallbackState | null,
): JobArtifactManifest {
  const acceptedEventIds = [
    ...(previousState?.acceptedEventIds ?? []),
    event.eventId,
  ].slice(-MAX_PERSISTED_EVENT_IDS)
  const terminal =
    event.type === "workflow_completed" || event.type === "workflow_failed"
      ? { type: event.type, at: getTerminalTimestamp(event) }
      : previousState?.terminal

  return {
    [CALLBACK_STATE_ARTIFACT_KEY]: {
      kind: "metadata",
      data: {
        runId: event.runId,
        lastAcceptedSequence: event.sequence,
        acceptedEventIds: Array.from(new Set(acceptedEventIds)),
        lastEventId: event.eventId,
        lastEventType: event.type,
        updatedAt: getTerminalTimestamp(event),
        ...(terminal ? { terminal } : {}),
      },
    },
  }
}

function hasPersistedEvent(
  state: PersistedCallbackState | null,
  event: AgenticSubtitleEvent,
): boolean {
  return Boolean(
    state?.runId === event.runId &&
    (state.acceptedEventIds.includes(event.eventId) ||
      event.sequence <= state.lastAcceptedSequence),
  )
}

function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed"
}

function isTerminalWorkflowEvent(event: AgenticSubtitleEvent): boolean {
  return event.type === "workflow_completed" || event.type === "workflow_failed"
}

function workflowFailureError(
  event: AgenticSubtitleEvent,
  job: JobRecord,
): JobError {
  const error = "error" in event ? event.error : undefined
  return {
    step: job.currentStep ?? "translation",
    message: getErrorMessage(error),
    at: getTerminalTimestamp(event),
    code: "agentic_workflow_failed",
  }
}

async function mapWorkflowEvent(
  event: AgenticSubtitleEvent,
  job: JobRecord,
  callbackStateArtifacts: JobArtifactManifest,
) {
  if (event.type === "workflow_started") {
    await updateJob(event.jobId, {
      status: "running",
      startedAt: getTerminalTimestamp(event),
    })
    await mergeArtifactsIfPresent(
      event.jobId,
      event.artifacts,
      callbackStateArtifacts,
    )
    return
  }

  if (event.type === "workflow_completed") {
    await updateJob(event.jobId, {
      status: "completed",
      completedAt: getTerminalTimestamp(event),
      artifacts: mergeArtifactInputs(
        job.artifacts,
        mergeArtifactInputs(event.artifacts, callbackStateArtifacts),
      ),
    })
    return
  }

  if (event.type === "workflow_failed") {
    await updateJob(event.jobId, {
      status: "failed",
      completedAt: getTerminalTimestamp(event),
      artifacts: mergeArtifactInputs(
        job.artifacts,
        mergeArtifactInputs(event.artifacts, callbackStateArtifacts),
      ),
      errors: [...job.errors, workflowFailureError(event, job)],
    })
  }
}

function stepStatusForEvent(
  type: AgenticSubtitleEvent["type"],
): StepStatus | null {
  if (type === "step_started") return "running"
  if (type === "step_completed") return "completed"
  if (type === "step_failed") return "failed"
  return null
}

async function mapStepEvent(
  event: Extract<AgenticSubtitleEvent, { step: WorkflowStepName }>,
  callbackStateArtifacts: JobArtifactManifest,
) {
  const status = stepStatusForEvent(event.type)
  if (!status) return

  if (event.type === "step_failed") {
    await updateStepStatus(
      event.jobId,
      event.step,
      status,
      getErrorMessage(event.error),
    )
    await mergeArtifactsIfPresent(
      event.jobId,
      event.artifacts,
      callbackStateArtifacts,
    )
    return
  }

  await updateStepStatus(event.jobId, event.step, status)
  await mergeArtifactsIfPresent(
    event.jobId,
    event.artifacts,
    callbackStateArtifacts,
  )
}

export async function ingestAgenticSubtitleEvent(
  event: AgenticSubtitleEvent,
): Promise<AgenticSubtitleEventResult> {
  const dedupKey = eventDedupKey(event)
  if (acceptedEventKeys.has(dedupKey)) {
    return { ok: true, deduped: true }
  }

  const lastSequence = lastSequenceByRunId.get(event.runId)
  if (lastSequence !== undefined && event.sequence <= lastSequence) {
    return { ok: true, deduped: true }
  }

  const job = await getJob(event.jobId)
  if (!job) {
    throw new Error(`Manager job ${event.jobId} was not found.`)
  }

  const persistedState = readPersistedCallbackState(job)
  if (hasPersistedEvent(persistedState, event)) {
    return { ok: true, deduped: true }
  }

  if (isTerminalJobStatus(job.status) && !isTerminalWorkflowEvent(event)) {
    return { ok: true, deduped: true }
  }

  const callbackStateArtifacts = buildCallbackStateArtifacts(
    event,
    persistedState,
  )

  if ("step" in event) {
    await mapStepEvent(event, callbackStateArtifacts)
  } else {
    await mapWorkflowEvent(event, job, callbackStateArtifacts)
  }

  acceptedEventKeys.add(dedupKey)
  lastSequenceByRunId.set(event.runId, event.sequence)
  return { ok: true, deduped: false }
}

export async function triggerAgenticSubtitleEnrichment(
  input: AgenticSubtitleEnrichmentInput,
): Promise<AgenticSubtitleEnrichmentResult> {
  if (!env.AGENTIC_BASE_URL || !env.AGENTIC_SERVICE_API_KEY) {
    return {
      ok: false,
      reason: "config_missing",
      messages: [
        "AGENTIC_BASE_URL and AGENTIC_SERVICE_API_KEY must be set on apps/manager to call the Agentic runtime",
      ],
      retryable: false,
    }
  }

  const timeoutMs =
    env.AGENTIC_REQUEST_TIMEOUT_MS ?? DEFAULT_AGENTIC_FETCH_TIMEOUT_MS
  const agenticUrl = `${env.AGENTIC_BASE_URL.replace(/\/+$/, "")}/forge/subtitle-enrichment-runs`

  let response: Response
  try {
    response = await fetch(agenticUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.AGENTIC_SERVICE_API_KEY}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    return {
      ok: false,
      reason: "network_error",
      messages: [
        isTimeout
          ? `Agentic subtitle enrichment request timed out after ${timeoutMs}ms`
          : message,
      ],
      retryable: true,
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return {
      ok: false,
      reason: "parse_error",
      messages: ["Agentic returned invalid JSON"],
      httpStatus: response.status,
      retryable: true,
    }
  }

  const parsed = agenticSubtitleRunEnvelopeSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "contract_error",
      messages: [
        "Agentic subtitle enrichment response did not match the expected contract",
      ],
      httpStatus: response.status,
      retryable: false,
    }
  }

  if (parsed.data.ok) {
    return parsed.data
  }

  return {
    ok: false,
    reason: "upstream_error",
    code: parsed.data.code,
    messages:
      parsed.data.messages ??
      (parsed.data.message
        ? [parsed.data.message]
        : ["Agentic subtitle enrichment failed"]),
    httpStatus: response.status,
    retryable: false,
  }
}
