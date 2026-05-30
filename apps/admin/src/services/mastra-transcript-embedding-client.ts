import { env } from "@/config/env"
import type { TranscriptSourceArtifact } from "@/services/manager-artifacts.service"

export type MastraTranscriptEmbeddingMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export type MastraTranscriptEmbeddingTarget = {
  videoId: string
  videoEditionId: string
  coreId?: string
}

export type MastraTranscriptEmbeddingLaunchInput = {
  target: MastraTranscriptEmbeddingTarget
  language: string
  cmsVideoId: number
  transcript: Pick<
    TranscriptSourceArtifact,
    "text" | "segments" | "resolvedProvider"
  >
  mode?: MastraTranscriptEmbeddingMode
}

export type MastraTranscriptEmbeddingLaunchResult =
  | {
      ok: true
      status: "created" | "unchanged" | "repaired" | "forced" | "model_upgraded"
      chunks: number
      totalTokens: number
      model: string
      provider: string
      dimensions: number
      mastraRunId: string
      sourceContentHash: string
    }
  | {
      ok: false
      reason:
        | "config_missing"
        | "auth_failed"
        | "network_error"
        | "parse_error"
        | "invalid_input"
        | "provider_config_missing"
        | "provider_auth_failed"
        | "provider_failed"
        | "provider_dimension_mismatch"
        | "admin_config_missing"
        | "admin_auth_failed"
        | "admin_ingest_rejected"
        | "admin_ingest_failed"
      retryable: boolean
      mastraRunId?: string
      adminStatus?: string
      adminReason?: string
    }

export type LaunchMastraTranscriptEmbeddingOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const SUCCESS_STATUSES = new Set([
  "created",
  "unchanged",
  "repaired",
  "forced",
  "model_upgraded",
])

const FAILURE_REASONS = new Set([
  "config_missing",
  "auth_failed",
  "network_error",
  "parse_error",
  "invalid_input",
  "provider_config_missing",
  "provider_auth_failed",
  "provider_failed",
  "provider_dimension_mismatch",
  "admin_config_missing",
  "admin_auth_failed",
  "admin_ingest_rejected",
  "admin_ingest_failed",
])

type TranscriptSourceSegment = TranscriptSourceArtifact["segments"][number]

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseWorkflowResult(
  value: unknown,
): MastraTranscriptEmbeddingLaunchResult | null {
  const record = asRecord(value)
  const result = asRecord(record?.result)
  if (!result || typeof result.ok !== "boolean") return null

  if (result.ok === true) {
    if (
      typeof result.status !== "string" ||
      !SUCCESS_STATUSES.has(result.status) ||
      typeof result.chunks !== "number" ||
      typeof result.totalTokens !== "number" ||
      typeof result.model !== "string" ||
      typeof result.provider !== "string" ||
      typeof result.dimensions !== "number" ||
      typeof result.mastraRunId !== "string" ||
      typeof result.sourceContentHash !== "string"
    ) {
      return null
    }
    return {
      ok: true,
      status: result.status as Extract<
        MastraTranscriptEmbeddingLaunchResult,
        { ok: true }
      >["status"],
      chunks: result.chunks,
      totalTokens: result.totalTokens,
      model: result.model,
      provider: result.provider,
      dimensions: result.dimensions,
      mastraRunId: result.mastraRunId,
      sourceContentHash: result.sourceContentHash,
    }
  }

  if (
    typeof result.reason !== "string" ||
    !FAILURE_REASONS.has(result.reason) ||
    typeof result.retryable !== "boolean"
  ) {
    return null
  }

  return {
    ok: false,
    reason: result.reason as Extract<
      MastraTranscriptEmbeddingLaunchResult,
      { ok: false }
    >["reason"],
    retryable: result.retryable,
    mastraRunId:
      typeof result.mastraRunId === "string" ? result.mastraRunId : undefined,
    adminStatus:
      typeof result.adminStatus === "string" ? result.adminStatus : undefined,
    adminReason:
      typeof result.adminReason === "string" ? result.adminReason : undefined,
  }
}

function normalizeSegments(
  segments: readonly TranscriptSourceSegment[],
): TranscriptSourceSegment[] {
  return segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text,
  }))
}

export async function launchMastraTranscriptEmbedding(
  input: MastraTranscriptEmbeddingLaunchInput,
  options: LaunchMastraTranscriptEmbeddingOptions = {},
): Promise<MastraTranscriptEmbeddingLaunchResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const body = {
    target: {
      admin: input.target,
    },
    language: input.language,
    transcript: {
      text: input.transcript.text,
      segments: normalizeSegments(input.transcript.segments),
      artifactKey: `${input.cmsVideoId}/transcript.json`,
      provider: input.transcript.resolvedProvider,
    },
    mode: input.mode ?? "idempotent",
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL("/forge-transcript-embeddings", baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          options.timeoutMs ??
            env.MASTRA_TRANSCRIPT_EMBEDDING_TIMEOUT_MS ??
            120_000,
        ),
      },
    )
  } catch {
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (response.status === 401) {
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  const result = parseWorkflowResult(
    await response.json().catch(() => undefined),
  )
  if (result) return result

  if (!response.ok) {
    return {
      ok: false,
      reason: "network_error",
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  return { ok: false, reason: "parse_error", retryable: true }
}

export const _internals = {
  parseWorkflowResult,
}
