import { createHash } from "node:crypto"
import { CmsHttpError, cmsPost } from "@/services/cmsClient"
import { artifactExists, readArtifact } from "@/services/storage"
import type { EmbeddingSyncReport } from "@/types/job"

type EmbeddingSyncMode = "if_missing" | "inspect" | "override"

type CmsEmbeddingIndexResponse = {
  status:
    | "missing"
    | "has_embeddings"
    | "applied_missing"
    | "skipped_existing"
    | "override_applied"
  videoDocumentId?: string
  resolvedVideoId: number
  hasEmbeddings: boolean
  chunkCount: number
  model?: string
  contentFingerprint?: string
}

type TranscriptChunkInput = {
  text: string
  embedding: number[]
}

type EmbeddingArtifactPayload = {
  model: string
  dimensions: number
  chunks: TranscriptChunkInput[]
  metadata?: {
    generatedAt?: string
  }
  metadataEmbedding?: unknown
}

type EmbeddingArtifactSummary = {
  generated: EmbeddingSyncReport["generated"]
  chunks: TranscriptChunkInput[]
}

export type SyncEmbeddingArtifactInput = {
  assetId: string
  videoDocumentId?: string
  mode?: EmbeddingSyncMode
  expectedGeneratedContentFingerprint?: string
  expectedExistingContentFingerprint?: string
  approvedByUserId?: string
  approvedAt?: string
}

const MAX_SYNC_CHUNKS = 500

function buildFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

export function buildGeneratedContentFingerprint(
  model: string,
  chunks: Array<Pick<TranscriptChunkInput, "text">>,
): string {
  return buildFingerprint({
    model,
    chunks: chunks.map((chunk, index) => ({
      index,
      text: chunk.text,
    })),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function isTranscriptChunk(value: unknown): value is TranscriptChunkInput {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    Array.isArray(value.embedding) &&
    value.embedding.every((entry) => typeof entry === "number")
  )
}

function normalizeEmbeddingsArtifact(
  value: unknown,
): EmbeddingArtifactPayload | undefined {
  if (!isRecord(value) || !Array.isArray(value.chunks)) {
    return undefined
  }

  if (
    typeof value.model !== "string" ||
    typeof value.dimensions !== "number" ||
    !Number.isFinite(value.dimensions)
  ) {
    return undefined
  }

  const chunks = value.chunks.filter(isTranscriptChunk)
  if (chunks.length !== value.chunks.length) {
    return undefined
  }

  return {
    model: value.model,
    dimensions: value.dimensions,
    chunks,
    ...(isRecord(value.metadata)
      ? {
          metadata: {
            ...(typeof value.metadata.generatedAt === "string"
              ? { generatedAt: value.metadata.generatedAt }
              : {}),
          },
        }
      : {}),
    ...(isRecord(value.metadataEmbedding)
      ? { metadataEmbedding: value.metadataEmbedding }
      : {}),
  }
}

async function loadEmbeddingArtifactSummary(
  assetId: string,
): Promise<
  | { ok: true; summary: EmbeddingArtifactSummary }
  | { ok: false; reason: string }
> {
  const exists = await artifactExists(assetId, "embeddings", "json")
  if (!exists) {
    return { ok: false, reason: "artifact_missing" }
  }

  try {
    const bytes = await readArtifact(assetId, "embeddings", "json")
    const payload = normalizeEmbeddingsArtifact(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    )

    if (!payload) {
      return { ok: false, reason: "artifact_invalid" }
    }

    return {
      ok: true,
      summary: {
        generated: {
          model: payload.model,
          dimensions: payload.dimensions,
          chunkCount: payload.chunks.length,
          contentFingerprint: buildGeneratedContentFingerprint(
            payload.model,
            payload.chunks,
          ),
          hasMetadataEmbedding: payload.metadataEmbedding != null,
          ...(typeof payload.metadata?.generatedAt === "string"
            ? { generatedAt: payload.metadata.generatedAt }
            : {}),
        },
        chunks: payload.chunks.map((chunk) => ({
          text: chunk.text,
          embedding: chunk.embedding,
        })),
      },
    }
  } catch {
    return { ok: false, reason: "artifact_invalid" }
  }
}

function buildReport(input: {
  generated: EmbeddingSyncReport["generated"]
  status: EmbeddingSyncReport["status"]
  videoDocumentId?: string
  reason?: string
  cms?: EmbeddingSyncReport["cms"]
  override?: EmbeddingSyncReport["override"]
}): EmbeddingSyncReport {
  return {
    domain: "embeddings",
    generated: input.generated,
    status: input.status,
    ...(input.videoDocumentId
      ? { videoDocumentId: input.videoDocumentId }
      : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.cms ? { cms: input.cms } : {}),
    ...(input.override ? { override: input.override } : {}),
  }
}

function mapCmsSummary(
  response: CmsEmbeddingIndexResponse,
): EmbeddingSyncReport["cms"] {
  return {
    resolvedVideoId: response.resolvedVideoId,
    hasEmbeddings: response.hasEmbeddings,
    chunkCount: response.chunkCount,
    ...(response.model ? { model: response.model } : {}),
    ...(response.contentFingerprint
      ? { contentFingerprint: response.contentFingerprint }
      : {}),
  }
}

function readCmsErrorCode(error: CmsHttpError): string | undefined {
  if (
    isRecord(error.responseData) &&
    typeof error.responseData.error === "string"
  ) {
    return error.responseData.error
  }
  return undefined
}

export async function syncEmbeddingArtifact(
  input: SyncEmbeddingArtifactInput,
): Promise<EmbeddingSyncReport> {
  const mode = input.mode ?? "if_missing"
  const artifact = await loadEmbeddingArtifactSummary(input.assetId)
  if (!artifact.ok) {
    return buildReport({
      generated: {
        model: "unknown",
        dimensions: 0,
        chunkCount: 0,
        contentFingerprint: "sha256:unavailable",
        hasMetadataEmbedding: false,
      },
      status: "failed",
      videoDocumentId: input.videoDocumentId,
      reason: artifact.reason,
    })
  }

  const { generated, chunks } = artifact.summary

  if (!input.videoDocumentId) {
    return buildReport({
      generated,
      status: "unsupported",
      reason: "no_video_document_id",
    })
  }

  if (generated.chunkCount === 0) {
    return buildReport({
      generated,
      status: "failed",
      videoDocumentId: input.videoDocumentId,
      reason: "no_transcript_chunks",
    })
  }

  if (generated.chunkCount > MAX_SYNC_CHUNKS) {
    return buildReport({
      generated,
      status: "unsupported",
      videoDocumentId: input.videoDocumentId,
      reason: "chunk_limit_exceeded",
    })
  }

  try {
    const response = await cmsPost<CmsEmbeddingIndexResponse>(
      "/embedding/index",
      {
        videoDocumentId: input.videoDocumentId,
        mode,
        ...(mode === "inspect"
          ? {}
          : {
              chunks,
              model: generated.model,
            }),
        ...(mode === "override"
          ? {
              expectedGeneratedContentFingerprint:
                input.expectedGeneratedContentFingerprint,
              expectedExistingContentFingerprint:
                input.expectedExistingContentFingerprint,
            }
          : {}),
      },
      {
        tokenScope:
          mode === "override" ? "embedding_override" : "embedding_sync",
      },
    )

    if (mode === "inspect" && response.status === "missing") {
      return buildReport({
        generated,
        status: "failed",
        videoDocumentId: input.videoDocumentId,
        reason: "cms_missing",
        cms: mapCmsSummary(response),
      })
    }

    return buildReport({
      generated,
      videoDocumentId: input.videoDocumentId,
      status:
        response.status === "applied_missing"
          ? "applied_missing"
          : response.status === "override_applied"
            ? "override_applied"
            : "skipped_existing",
      cms: mapCmsSummary(response),
      ...(mode === "override" &&
      input.approvedByUserId &&
      input.approvedAt &&
      response.status === "override_applied"
        ? {
            override: {
              approvedByUserId: input.approvedByUserId,
              approvedAt: input.approvedAt,
            },
          }
        : {}),
    })
  } catch (error) {
    if (error instanceof CmsHttpError) {
      const cmsErrorCode = readCmsErrorCode(error)
      if (mode === "override" && cmsErrorCode === "stale_compare") {
        throw error
      }

      return buildReport({
        generated,
        status: "failed",
        videoDocumentId: input.videoDocumentId,
        reason: cmsErrorCode ?? "cms_request_failed",
      })
    }

    return buildReport({
      generated,
      status: "failed",
      videoDocumentId: input.videoDocumentId,
      reason: "cms_request_failed",
    })
  }
}
