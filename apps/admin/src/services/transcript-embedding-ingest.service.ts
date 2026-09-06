import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import {
  EmbeddingGenerationModeSchema,
  EmbeddingTimestampSchema,
  statusForEmbeddingRewrite,
} from "@/services/embedding-ingest-shared"
import {
  writeTranscriptEmbeddingPayloadInTransaction,
  type TranscriptEmbeddingGenerationMode,
  type TranscriptEmbeddingPayloadChunk,
} from "@/services/transcript-embedding.service"
import {
  contentEmbeddingTupleMatches,
  resolveActiveContentEmbeddingContract,
  type ContentEmbeddingContract,
  type ContentEmbeddingTuple,
} from "@/services/content-embedding-contract"

const AdminTargetSchema = z
  .object({
    videoId: z.string().min(1),
    videoEditionId: z.string().min(1),
    coreId: z.string().min(1).optional(),
  })
  .strict()

const ExternalTargetSchema = z
  .object({
    assetId: z.string().min(1).optional(),
    muxAssetId: z.string().min(1).optional(),
    adminVideoId: z.string().min(1).optional(),
  })
  .strict()

const TranscriptSourceSegmentSchema = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    text: z.string(),
  })
  .strict()

export const CANONICAL_FELT_NEEDS = [
  "Acceptance",
  "Anxiety",
  "Depression",
  "Fear/Power",
  "Forgiveness",
  "Guilt/Righteousness",
  "Honor/Shame",
  "Hope",
  "Loneliness",
  "Love",
  "Security",
  "Significance",
] as const

const FeltNeedSchema = z.enum(CANONICAL_FELT_NEEDS)

const IngestChunkSchema = z
  .object({
    chunkIndex: z.number().int().nonnegative(),
    chunkId: z.string().min(1),
    text: z.string().min(1),
    tokenCount: z.number().int().nonnegative(),
    startSeconds: z.number().finite().nonnegative().optional(),
    endSeconds: z.number().finite().nonnegative().optional(),
    rawSourceText: z.string().min(1).optional(),
    embeddingInputText: z.string().min(1).optional(),
    feltNeeds: z.array(FeltNeedSchema).default([]),
    bibleVerses: z.array(z.string().min(1)).default([]),
    contentSummary: z.string().min(1).optional(),
    tone: z.string().min(1).optional(),
    demographics: z.array(z.string().min(1)).default([]),
    spiritualContext: z.array(z.string().min(1)).default([]),
    extractionMetadata: z.record(z.string(), z.unknown()).optional(),
    embedding: z.array(z.number().finite()).min(1),
  })
  .strict()

export const TranscriptEmbeddingIngestPayloadSchema = z
  .object({
    target: z
      .object({
        admin: AdminTargetSchema.optional(),
        external: ExternalTargetSchema.optional(),
      })
      .strict(),
    language: z.string().min(1),
    source: z
      .object({
        text: z.string().optional(),
        segments: z.array(TranscriptSourceSegmentSchema).optional(),
        artifactKey: z.string().min(1).optional(),
        kind: z.enum(["subtitle", "manager-transcript"]).optional(),
        languageId: z.string().min(1).optional(),
        languageSlug: z.string().min(1).optional(),
        subtitleId: z.string().min(1).optional(),
        format: z.enum(["vtt", "srt"]).optional(),
        url: z.string().min(1).optional(),
        provider: z.string().min(1).optional(),
        generatedAt: EmbeddingTimestampSchema.optional(),
        contentHash: z.string().min(1),
      })
      .strict(),
    model: z
      .object({
        name: z.string().min(1),
        dimensions: z.number().int().positive(),
        nativeDimensions: z.number().int().positive().optional(),
        provider: z.string().min(1).optional(),
        transformVersion: z.string().min(1).optional(),
      })
      .strict(),
    chunking: z
      .object({
        type: z.enum(["segment-aware", "plain-text"]),
        maxChunkTokens: z.number().int().positive(),
        overlapTokens: z.number().int().nonnegative(),
        version: z.string().min(1).optional(),
      })
      .strict(),
    generation: z
      .object({
        mode: EmbeddingGenerationModeSchema,
        generatedAt: EmbeddingTimestampSchema,
        mastraRunId: z.string().min(1),
      })
      .strict(),
    chunks: z.array(IngestChunkSchema).min(1),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const hasAdminTarget = payload.target.admin != null
    const hasExternalTarget = payload.target.external != null
    if (hasAdminTarget === hasExternalTarget) {
      ctx.addIssue({
        code: "custom",
        path: ["target"],
        message: "exactly one target.admin or target.external is required",
      })
    }

    const externalAssetId = payload.target.external?.assetId
    if (
      externalAssetId &&
      payload.source.artifactKey &&
      !payload.source.artifactKey.startsWith(`${externalAssetId}/`)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["source", "artifactKey"],
        message: "source artifactKey must match target.external.assetId",
      })
    }

    for (const [index, segment] of payload.source.segments?.entries() ?? []) {
      if (segment.end < segment.start) {
        ctx.addIssue({
          code: "custom",
          path: ["source", "segments", index, "end"],
          message: "segment end must be greater than or equal to start",
        })
      }
    }
  })

export type TranscriptEmbeddingIngestPayload = z.infer<
  typeof TranscriptEmbeddingIngestPayloadSchema
>

type ResolvedTarget = {
  videoId: string
  videoEditionId: string
  coreId: string
}

type ExistingTranscript = {
  id: string
  sourceContentHash: string | null
  model: string
  dimensions: number
  embeddingProvider: string | null
  embeddingNativeDimensions: number | null
  embeddingTransformVersion: string | null
  chunkingType: string
  maxChunkTokens: number
  overlapTokens: number
  totalChunks: number
  totalTokens: number
}

export type TranscriptEmbeddingIngestStatus =
  | "created"
  | "unchanged"
  | "repaired"
  | "forced"
  | "model_upgraded"
  | "rejected"

export type TranscriptEmbeddingIngestResult = {
  status: TranscriptEmbeddingIngestStatus
  reason?: string
  target: ResolvedTarget & { language: string }
  chunks: number
  model: string
  dimensions: number
  mastraRunId: string
}

export class TranscriptEmbeddingIngestError extends Error {
  constructor(
    readonly code:
      | "payload_invalid"
      | "target_not_found"
      | "target_ambiguous"
      | "contract_mismatch"
      | "dimension_mismatch"
      | "chunk_invalid"
      | "source_hash_mismatch"
      | "write_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "TranscriptEmbeddingIngestError"
  }
}

const TRANSCRIPT_INGEST_TRANSACTION_TIMEOUT_MS = 30_000
const TRANSCRIPT_INGEST_TRANSACTION_MAX_ATTEMPTS = 3
const TRANSCRIPT_INGEST_TRANSACTION_RETRY_DELAY_MS = 250

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableTranscriptIngestTransactionError(error: unknown): boolean {
  const record =
    error && typeof error === "object"
      ? (error as { name?: unknown; code?: unknown; message?: unknown })
      : null
  const name = typeof record?.name === "string" ? record.name : ""
  const code = typeof record?.code === "string" ? record.code : ""
  const message =
    error instanceof Error
      ? error.message
      : typeof record?.message === "string"
        ? record.message
        : ""

  const isCurrentErrorRetryable =
    name === "PrismaClientKnownRequestError" &&
    (code === "P2034" ||
      (code === "P2010" &&
        /40001|40P01|serialize|serialization|deadlock/i.test(message)))
  if (isCurrentErrorRetryable) return true

  const nestedCause =
    record && "cause" in record
      ? (record as { cause?: unknown }).cause
      : error instanceof TranscriptEmbeddingIngestError
        ? error.cause
        : undefined

  return (
    nestedCause !== undefined &&
    isRetryableTranscriptIngestTransactionError(nestedCause)
  )
}

function transactionRetryDelayMs(attempt: number): number {
  return (
    TRANSCRIPT_INGEST_TRANSACTION_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1)
  )
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`
}

function sourceContentHash(payload: TranscriptEmbeddingIngestPayload): string {
  const hasV2SourceMetadata =
    payload.source.kind != null ||
    payload.source.languageId != null ||
    payload.source.languageSlug != null ||
    payload.source.subtitleId != null ||
    payload.source.format != null ||
    payload.source.url != null

  const computed = sha256Json({
    text: payload.source.text ?? null,
    segments: payload.source.segments ?? null,
    ...(hasV2SourceMetadata
      ? {
          source: {
            kind: payload.source.kind ?? null,
            artifactKey: payload.source.artifactKey ?? null,
            languageId: payload.source.languageId ?? null,
            languageSlug: payload.source.languageSlug ?? null,
            subtitleId: payload.source.subtitleId ?? null,
            format: payload.source.format ?? null,
            url: payload.source.url ?? null,
            provider: payload.source.provider ?? null,
            generatedAt: payload.source.generatedAt ?? null,
          },
        }
      : {}),
    chunks: payload.chunks.map((chunk) => {
      const base = {
        index: chunk.chunkIndex,
        text: chunk.text,
        startSeconds: chunk.startSeconds ?? null,
        endSeconds: chunk.endSeconds ?? null,
      }
      const hasEnrichedFields =
        chunk.rawSourceText != null ||
        chunk.embeddingInputText != null ||
        chunk.feltNeeds.length > 0 ||
        chunk.bibleVerses.length > 0 ||
        chunk.contentSummary != null ||
        chunk.tone != null ||
        chunk.demographics.length > 0 ||
        chunk.spiritualContext.length > 0 ||
        chunk.extractionMetadata != null

      return hasEnrichedFields
        ? {
            ...base,
            rawSourceText: chunk.rawSourceText ?? null,
            embeddingInputText: chunk.embeddingInputText ?? null,
            feltNeeds: chunk.feltNeeds,
            bibleVerses: chunk.bibleVerses,
            contentSummary: chunk.contentSummary ?? null,
            tone: chunk.tone ?? null,
            demographics: chunk.demographics,
            spiritualContext: chunk.spiritualContext,
            extractionMetadata: chunk.extractionMetadata ?? null,
          }
        : base
    }),
  })

  if (payload.source.contentHash && payload.source.contentHash !== computed) {
    throw new TranscriptEmbeddingIngestError(
      "source_hash_mismatch",
      "source content hash does not match payload content",
    )
  }

  return computed
}

function validateChunks(
  payload: TranscriptEmbeddingIngestPayload,
  contract: ContentEmbeddingContract,
): readonly TranscriptEmbeddingPayloadChunk[] {
  if (payload.model.dimensions !== contract.storage.dimensions) {
    throw new TranscriptEmbeddingIngestError(
      "dimension_mismatch",
      `payload dimensions=${payload.model.dimensions}; expected ${contract.storage.dimensions}`,
    )
  }

  const seen = new Set<number>()
  for (const chunk of payload.chunks) {
    if (seen.has(chunk.chunkIndex)) {
      throw new TranscriptEmbeddingIngestError(
        "chunk_invalid",
        "duplicate chunkIndex in transcript embedding payload",
      )
    }
    seen.add(chunk.chunkIndex)
    if (chunk.embedding.length !== payload.model.dimensions) {
      throw new TranscriptEmbeddingIngestError(
        "dimension_mismatch",
        "chunk embedding length does not match payload dimensions",
      )
    }
    if (
      chunk.endSeconds != null &&
      chunk.endSeconds < (chunk.startSeconds ?? 0)
    ) {
      throw new TranscriptEmbeddingIngestError(
        "chunk_invalid",
        "chunk endSeconds must be greater than or equal to startSeconds",
      )
    }
    if (!chunk.text.trim()) {
      throw new TranscriptEmbeddingIngestError(
        "chunk_invalid",
        "chunk text must not be empty",
      )
    }
  }

  const sorted = [...payload.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index]!.chunkIndex !== index) {
      throw new TranscriptEmbeddingIngestError(
        "chunk_invalid",
        "chunk indexes must be contiguous from 0",
      )
    }
  }
  return sorted
}

function payloadEmbeddingTuple(
  payload: TranscriptEmbeddingIngestPayload,
): ContentEmbeddingTuple | null {
  if (
    payload.model.provider == null ||
    payload.model.nativeDimensions == null
  ) {
    return null
  }

  return {
    provider: payload.model.provider,
    model: payload.model.name,
    nativeDimensions: payload.model.nativeDimensions,
    dimensions: payload.model.dimensions,
    transformVersion: payload.model.transformVersion ?? null,
  }
}

function assertPayloadMatchesActiveContract(
  payload: TranscriptEmbeddingIngestPayload,
  contract: ContentEmbeddingContract,
): void {
  const payloadTuple = payloadEmbeddingTuple(payload)
  if (
    payloadTuple == null ||
    !contentEmbeddingTupleMatches(contract.storage, payloadTuple)
  ) {
    throw new TranscriptEmbeddingIngestError(
      "contract_mismatch",
      `transcript embedding payload does not match active content embedding contract ${contract.id}`,
    )
  }
}

async function resolveTarget(
  prisma: PrismaClient,
  payload: TranscriptEmbeddingIngestPayload,
): Promise<ResolvedTarget> {
  if (payload.target.admin) {
    const row = await prisma.video.findFirst({
      where: { id: payload.target.admin.videoId, deletedAt: null },
      select: { id: true, coreId: true },
    })
    if (!row) {
      throw new TranscriptEmbeddingIngestError(
        "target_not_found",
        "admin target video was not found",
      )
    }
    if (
      payload.target.admin.coreId !== undefined &&
      payload.target.admin.coreId !== row.coreId
    ) {
      throw new TranscriptEmbeddingIngestError(
        "target_not_found",
        "admin target coreId does not match resolved video",
      )
    }
    const edition = await prisma.videoEdition.findFirst({
      where: {
        id: payload.target.admin.videoEditionId,
        dubs: { some: { videoId: row.id, deletedAt: null } },
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!edition) {
      throw new TranscriptEmbeddingIngestError(
        "target_not_found",
        "admin target video edition was not found",
      )
    }
    return {
      videoId: row.id,
      videoEditionId: edition.id,
      coreId: row.coreId,
    }
  }

  const external = payload.target.external
  if (!external?.muxAssetId) {
    throw new TranscriptEmbeddingIngestError(
      "target_not_found",
      "external transcript ingest requires muxAssetId",
    )
  }

  const rows = await prisma.$queryRaw<ResolvedTarget[]>`
    SELECT DISTINCT
      dub.video_id AS "videoId",
      dub.video_edition_id AS "videoEditionId",
      v.core_id AS "coreId"
    FROM video_dub dub
    JOIN video v
      ON v.id = dub.video_id
      AND v.deleted_at IS NULL
    JOIN mux_video mux
      ON mux.id = dub.mux_video_id
      AND mux.deleted_at IS NULL
    LEFT JOIN language lang
      ON lang.id = dub.language_id
      AND lang.deleted_at IS NULL
    WHERE mux.asset_id = ${external.muxAssetId}
      AND (
        ${external.adminVideoId ?? null}::text IS NULL
        OR v.id = ${external.adminVideoId ?? null}
      )
      AND dub.deleted_at IS NULL
      AND dub.video_edition_id IS NOT NULL
      AND (
        lang.bcp47 = ${payload.language}
        OR lang.bcp47 IS NULL
      )
  `

  if (rows.length === 0) {
    throw new TranscriptEmbeddingIngestError(
      "target_not_found",
      "external transcript target could not be resolved",
    )
  }
  if (rows.length > 1) {
    throw new TranscriptEmbeddingIngestError(
      "target_ambiguous",
      "external transcript target resolved to multiple admin videos/editions",
    )
  }
  return rows[0]!
}

async function readExistingTranscript(
  prisma: PrismaClient | Prisma.TransactionClient,
  target: ResolvedTarget,
  language: string,
): Promise<ExistingTranscript | null> {
  const rows = await prisma.$queryRaw<ExistingTranscript[]>`
    SELECT
      id,
      source_content_hash AS "sourceContentHash",
      model,
      dimensions,
      embedding_provider AS "embeddingProvider",
      embedding_native_dimensions AS "embeddingNativeDimensions",
      embedding_transform_version AS "embeddingTransformVersion",
      chunking_type AS "chunkingType",
      max_chunk_tokens AS "maxChunkTokens",
      overlap_tokens AS "overlapTokens",
      total_chunks AS "totalChunks",
      total_tokens AS "totalTokens"
    FROM video_transcript
    WHERE video_edition_id = ${target.videoEditionId}
      AND language = ${language}
    LIMIT 1
  `
  return rows[0] ?? null
}

async function countHealthyChunks(
  prisma: PrismaClient | Prisma.TransactionClient,
  transcriptId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
    SELECT COUNT(*) AS count
    FROM video_transcript_chunk
    WHERE transcript_id = ${transcriptId}
      AND embedding IS NOT NULL
  `
  return Number(rows[0]?.count ?? 0)
}

function existingMatches(
  existing: ExistingTranscript,
  payload: TranscriptEmbeddingIngestPayload,
  hash: string,
): boolean {
  return (
    existing.sourceContentHash === hash &&
    existing.model === payload.model.name &&
    existing.dimensions === payload.model.dimensions &&
    existing.embeddingProvider === (payload.model.provider ?? null) &&
    existing.embeddingNativeDimensions ===
      (payload.model.nativeDimensions ?? null) &&
    existing.embeddingTransformVersion ===
      (payload.model.transformVersion ?? null) &&
    existing.chunkingType === payload.chunking.type &&
    existing.maxChunkTokens === payload.chunking.maxChunkTokens &&
    existing.overlapTokens === payload.chunking.overlapTokens &&
    existing.totalChunks === payload.chunks.length &&
    existing.totalTokens ===
      payload.chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)
  )
}

function resultForRejected(
  payload: TranscriptEmbeddingIngestPayload,
  target: ResolvedTarget,
  reason: string,
): TranscriptEmbeddingIngestResult {
  return {
    status: "rejected",
    reason,
    target: { ...target, language: payload.language },
    chunks: payload.chunks.length,
    model: payload.model.name,
    dimensions: payload.model.dimensions,
    mastraRunId: payload.generation.mastraRunId,
  }
}

async function writePayload(
  tx: Prisma.TransactionClient,
  payload: TranscriptEmbeddingIngestPayload,
  target: ResolvedTarget,
  chunks: readonly TranscriptEmbeddingPayloadChunk[],
  hash: string,
): Promise<void> {
  try {
    await writeTranscriptEmbeddingPayloadInTransaction(tx, {
      editionId: target.videoEditionId,
      videoId: target.videoId,
      coreId: target.coreId,
      language: payload.language,
      user: SYSTEM_PRINCIPAL,
      model: payload.model.name,
      dimensions: payload.model.dimensions,
      chunks,
      chunking: {
        type: payload.chunking.type,
        maxChunkTokens: payload.chunking.maxChunkTokens,
        overlapTokens: payload.chunking.overlapTokens,
      },
      totalTokens: chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
      generatedAt: payload.generation.generatedAt,
      provenance: {
        embeddingProvider: payload.model.provider,
        embeddingNativeDimensions: payload.model.nativeDimensions,
        embeddingTransformVersion: payload.model.transformVersion,
        sourceArtifactKey: payload.source.artifactKey,
        sourceKind: payload.source.kind,
        sourceLanguageId: payload.source.languageId,
        sourceLanguageSlug: payload.source.languageSlug,
        sourceSubtitleId: payload.source.subtitleId,
        sourceFormat: payload.source.format,
        sourceUrl: payload.source.url,
        sourceContentHash: hash,
        sourceProvider: payload.source.provider ?? payload.model.provider,
        sourceGeneratedAt: payload.source.generatedAt,
        generationMode: payload.generation.mode,
        mastraRunId: payload.generation.mastraRunId,
        chunkingVersion: payload.chunking.version,
      },
    })
  } catch (error) {
    throw new TranscriptEmbeddingIngestError(
      "write_failed",
      "failed to write transcript embedding payload",
      error,
    )
  }
}

async function lockTranscriptTarget(
  tx: Prisma.TransactionClient,
  target: ResolvedTarget,
  language: string,
): Promise<void> {
  await tx.$queryRaw`
    WITH lock AS (
      SELECT pg_advisory_xact_lock(
        hashtext(${`transcript:${target.videoEditionId}`}),
        hashtext(${language})
      )
    )
    SELECT 1::int AS locked
  `
}

export async function ingestTranscriptEmbeddings(
  prisma: PrismaClient,
  rawPayload: unknown,
): Promise<TranscriptEmbeddingIngestResult> {
  const parsed = TranscriptEmbeddingIngestPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    console.warn(
      `[mastra-transcript-ingest] event=payload_invalid issues=${parsed.error.issues.length}`,
    )
    throw new TranscriptEmbeddingIngestError(
      "payload_invalid",
      "transcript embedding ingest payload failed validation",
      parsed.error,
    )
  }

  const payload = parsed.data
  const hash = sourceContentHash(payload)
  const target = await resolveTarget(prisma, payload)
  const mode = payload.generation.mode as TranscriptEmbeddingGenerationMode

  for (
    let attempt = 1;
    attempt <= TRANSCRIPT_INGEST_TRANSACTION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const contract = await resolveActiveContentEmbeddingContract(tx)
          assertPayloadMatchesActiveContract(payload, contract)
          const chunks = validateChunks(payload, contract)
          await lockTranscriptTarget(tx, target, payload.language)
          const existing = await readExistingTranscript(
            tx,
            target,
            payload.language,
          )

          if (existing) {
            const matches = existingMatches(existing, payload, hash)
            const healthyChunks = matches
              ? await countHealthyChunks(tx, existing.id)
              : 0

            if (
              mode === "idempotent" &&
              matches &&
              healthyChunks === payload.chunks.length
            ) {
              return {
                status: "unchanged",
                target: { ...target, language: payload.language },
                chunks: payload.chunks.length,
                model: payload.model.name,
                dimensions: payload.model.dimensions,
                mastraRunId: payload.generation.mastraRunId,
              }
            }

            if (mode === "idempotent") {
              return resultForRejected(
                payload,
                target,
                "existing_transcript_differs",
              )
            }

            if (mode === "repair" && !matches) {
              return resultForRejected(
                payload,
                target,
                "repair_requires_matching_provenance",
              )
            }
            if (mode === "repair" && healthyChunks === payload.chunks.length) {
              return {
                status: "unchanged",
                target: { ...target, language: payload.language },
                chunks: payload.chunks.length,
                model: payload.model.name,
                dimensions: payload.model.dimensions,
                mastraRunId: payload.generation.mastraRunId,
              }
            }
          }

          let status: TranscriptEmbeddingIngestStatus = "created"
          if (existing) {
            if (mode === "idempotent") {
              return resultForRejected(
                payload,
                target,
                "existing_transcript_differs",
              )
            }
            status = statusForEmbeddingRewrite(mode)
          }

          await writePayload(tx, payload, target, chunks, hash)

          return {
            status,
            target: { ...target, language: payload.language },
            chunks: payload.chunks.length,
            model: payload.model.name,
            dimensions: payload.model.dimensions,
            mastraRunId: payload.generation.mastraRunId,
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: TRANSCRIPT_INGEST_TRANSACTION_TIMEOUT_MS,
        },
      )
    } catch (error) {
      if (
        attempt >= TRANSCRIPT_INGEST_TRANSACTION_MAX_ATTEMPTS ||
        !isRetryableTranscriptIngestTransactionError(error)
      ) {
        throw error
      }

      const delayMs = transactionRetryDelayMs(attempt)
      console.warn(
        JSON.stringify({
          event: "transcript_embedding_ingest_transaction_retry",
          target: {
            videoId: target.videoId,
            videoEditionId: target.videoEditionId,
            coreId: target.coreId,
          },
          language: payload.language,
          mastraRunId: payload.generation.mastraRunId,
          attempt,
          maxAttempts: TRANSCRIPT_INGEST_TRANSACTION_MAX_ATTEMPTS,
          delayMs,
          code:
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code ?? "")
              : "unknown",
        }),
      )
      await sleep(delayMs)
    }
  }

  throw new TranscriptEmbeddingIngestError(
    "write_failed",
    "transcript embedding ingest retry loop exhausted unexpectedly",
  )
}

export const _internals = {
  sha256Json,
  sourceContentHash,
  validateChunks,
  existingMatches,
  isRetryableTranscriptIngestTransactionError,
}
