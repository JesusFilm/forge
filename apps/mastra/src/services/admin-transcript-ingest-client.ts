import {
  asRecord,
  callAdminEmbeddingIngest,
  isAdminEmbeddingIngestStatus,
  type AdminEmbeddingIngestClientResult,
  type EmbeddingGenerationMode,
} from "./admin-embedding-ingest-client"

export type TranscriptEmbeddingGenerationMode = EmbeddingGenerationMode

export type AdminTranscriptEmbeddingIngestPayload = {
  target: {
    admin?: {
      videoId: string
      videoEditionId: string
      coreId?: string
    }
    external?: {
      assetId?: string
      muxAssetId?: string
      adminVideoId?: string
    }
  }
  language: string
  source: {
    text?: string
    segments?: Array<{ start: number; end: number; text: string }>
    artifactKey?: string
    kind?: "subtitle" | "manager-transcript"
    languageId?: string
    languageSlug?: string
    subtitleId?: string
    format?: "vtt" | "srt"
    url?: string
    provider?: string
    generatedAt?: string
    contentHash: string
  }
  model: {
    name: string
    dimensions: number
    nativeDimensions?: number
    provider?: string
    transformVersion?: string
  }
  chunking: {
    type: "segment-aware" | "plain-text"
    maxChunkTokens: number
    overlapTokens: number
    version?: string
  }
  generation: {
    mode: TranscriptEmbeddingGenerationMode
    generatedAt: string
    mastraRunId: string
  }
  chunks: Array<{
    chunkIndex: number
    chunkId: string
    text: string
    tokenCount: number
    startSeconds?: number
    endSeconds?: number
    rawSourceText?: string
    embeddingInputText?: string
    feltNeeds?: string[]
    bibleVerses?: string[]
    contentSummary?: string
    tone?: string
    demographics?: string[]
    spiritualContext?: string[]
    extractionMetadata?: Record<string, unknown>
    embedding: number[]
  }>
}

export type AdminTranscriptEmbeddingIngestResult = {
  status:
    | "created"
    | "unchanged"
    | "repaired"
    | "forced"
    | "model_upgraded"
    | "rejected"
  reason?: string
  target: {
    videoId: string
    videoEditionId: string
    coreId: string
    language: string
  }
  chunks: number
  model: string
  dimensions: number
  mastraRunId: string
}

export type AdminTranscriptIngestClientResult =
  AdminEmbeddingIngestClientResult<AdminTranscriptEmbeddingIngestResult>

export type CallAdminTranscriptIngestInput = {
  ingestUrl?: string
  bearer?: string
  payload: AdminTranscriptEmbeddingIngestPayload
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function parseAdminResult(
  body: unknown,
): AdminTranscriptEmbeddingIngestResult | null {
  const record = asRecord(body)
  const result = asRecord(record?.result)
  if (!result) return null

  if (
    !isAdminEmbeddingIngestStatus(result.status) ||
    typeof result.chunks !== "number" ||
    typeof result.model !== "string" ||
    typeof result.dimensions !== "number" ||
    typeof result.mastraRunId !== "string"
  ) {
    return null
  }

  const target = asRecord(result.target)
  if (
    !target ||
    typeof target.videoId !== "string" ||
    typeof target.videoEditionId !== "string" ||
    typeof target.coreId !== "string" ||
    typeof target.language !== "string"
  ) {
    return null
  }

  return {
    status: result.status,
    reason: typeof result.reason === "string" ? result.reason : undefined,
    target: {
      videoId: target.videoId,
      videoEditionId: target.videoEditionId,
      coreId: target.coreId,
      language: target.language,
    },
    chunks: result.chunks,
    model: result.model,
    dimensions: result.dimensions,
    mastraRunId: result.mastraRunId,
  }
}

export async function callAdminTranscriptIngest({
  ingestUrl,
  bearer,
  payload,
  timeoutMs = 30_000,
  fetchImpl = fetch,
}: CallAdminTranscriptIngestInput): Promise<AdminTranscriptIngestClientResult> {
  return callAdminEmbeddingIngest({
    ingestUrl,
    bearer,
    payload,
    parseResult: parseAdminResult,
    timeoutMs,
    fetchImpl,
  })
}

export const _internals = {
  parseAdminResult,
}
