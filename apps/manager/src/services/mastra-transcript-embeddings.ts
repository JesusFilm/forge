import { env } from "@/config/env"
import type { TranscriptSegment } from "@/services/transcription"

export type MastraTranscriptEmbeddingMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export type MastraTranscriptEmbeddingInput = {
  assetId: string
  muxAssetId: string
  adminVideoId?: string
  language: string
  transcript: {
    text: string
    segments?: TranscriptSegment[]
    artifactKey?: string
    kind?: "manager-transcript"
    provider?: string
    generatedAt?: string
  }
  mode?: MastraTranscriptEmbeddingMode
}

export type MastraTranscriptEmbeddingResult =
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
      chunking: {
        type: "segment-aware" | "plain-text"
        maxChunkTokens: number
        overlapTokens: number
        version: string
      }
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

export type LaunchMastraTranscriptEmbeddingsOptions = {
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

const CHUNKING_TYPES = new Set(["segment-aware", "plain-text"])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseWorkflowResult(
  value: unknown,
): MastraTranscriptEmbeddingResult | null {
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
    const chunking = asRecord(result.chunking)
    if (
      !chunking ||
      typeof chunking.type !== "string" ||
      !CHUNKING_TYPES.has(chunking.type) ||
      typeof chunking.maxChunkTokens !== "number" ||
      typeof chunking.overlapTokens !== "number" ||
      typeof chunking.version !== "string"
    ) {
      return null
    }

    return {
      ok: true,
      status: result.status as Extract<
        MastraTranscriptEmbeddingResult,
        { ok: true }
      >["status"],
      chunks: result.chunks,
      totalTokens: result.totalTokens,
      model: result.model,
      provider: result.provider,
      dimensions: result.dimensions,
      mastraRunId: result.mastraRunId,
      sourceContentHash: result.sourceContentHash,
      chunking: {
        type: chunking.type as "segment-aware" | "plain-text",
        maxChunkTokens: chunking.maxChunkTokens,
        overlapTokens: chunking.overlapTokens,
        version: chunking.version,
      },
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
      MastraTranscriptEmbeddingResult,
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

export async function launchMastraTranscriptEmbeddings(
  input: MastraTranscriptEmbeddingInput,
  options: LaunchMastraTranscriptEmbeddingsOptions = {},
): Promise<MastraTranscriptEmbeddingResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const body = {
    target: {
      external: {
        assetId: input.assetId,
        muxAssetId: input.muxAssetId,
        ...(input.adminVideoId ? { adminVideoId: input.adminVideoId } : {}),
      },
    },
    language: input.language,
    transcript: {
      text: input.transcript.text,
      segments: input.transcript.segments,
      artifactKey:
        input.transcript.artifactKey ?? `${input.assetId}/transcript.json`,
      kind: input.transcript.kind ?? "manager-transcript",
      provider: input.transcript.provider,
      generatedAt: input.transcript.generatedAt,
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
  if (result) {
    return result
  }

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
