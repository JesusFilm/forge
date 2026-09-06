// Transcript embedding indexer — writes VideoTranscript +
// VideoTranscriptChunk rows into admin's Postgres with vectors supplied
// by Mastra's transcript embedding workflow.
//
// Admin owns storage and retrieval; Mastra owns chunk planning and
// provider calls. The writer remains deliberately storage-focused: it
// validates dimensions/text, upserts the transcript parent, prunes stale
// chunks, and bulk-inserts chunk vectors into the existing pgvector table.
//
// ABAC: canWriteDerived gates entry. The backfill workflow runs as
// SYSTEM; ADMIN principals may also invoke for incident response.
//
// Idempotent: re-running for the same (editionId, language) upserts
// `VideoTranscript` and overwrites child chunks. A pre-transaction
// prune removes chunks whose chunkIndex is outside the incoming range
// so re-chunking with fewer segments doesn't leave orphans.
//
// Stage 3 of the embed-backfill performance plan (feat-117) collapses
// the per-chunk write loop into ONE bulk SQL statement per
// `(video, edition, language)` target — `INSERT INTO
// video_transcript_chunk … SELECT * FROM unnest(...) parallel arrays
// ON CONFLICT (transcript_id, chunk_index) DO UPDATE`. Per-row Way A
// `::vector(1536)` cast at the SELECT seam (NOT a `::vector(1536)[]`
// parameter cast — that array-input parser is less-trodden code; Way A
// keeps the cast at one site per row). See
// docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md.

import { Buffer } from "node:buffer"
import { randomUUID } from "node:crypto"

import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { canWriteDerived } from "@/auth/permissions"
import {
  assertParallelArrayLengthsMatch,
  toPgArray,
  toPgVector,
} from "@/db/pgvector"
import {
  isPrismaRuntimeError,
  sanitizePrismaErrorMessage,
} from "@/db/prisma-errors"
import {
  ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
} from "./content-embedding-contract"

/**
 * Manager transcript artifacts still store `text-embedding-3-small`
 * vectors at 1536 dimensions. Artifacts with a different dimension
 * count are rejected as invalid rather than silently truncated or
 * padded.
 */
export const EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS =
  ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS

/**
 * Admin's expected embedding model. Mastra may report the legacy
 * provider-prefixed OpenAI name, the bare OpenAI name, or the AI Gateway
 * request model. A mismatch is logged as a warning but does not reject
 * the payload here; intentional model replacement must use the ingest
 * service's explicit generation modes.
 */
export const ACCEPTED_TRANSCRIPT_EMBEDDING_MODEL_STAMPS: ReadonlySet<string> =
  new Set<string>([
    "openai/text-embedding-3-small",
    "text-embedding-3-small",
    ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
  ])

// Precomputed list form for the drift-warning log payload. Avoids
// re-serializing the Set on every mismatch.
const ACCEPTED_MODEL_STAMPS_LIST = Array.from(
  ACCEPTED_TRANSCRIPT_EMBEDDING_MODEL_STAMPS,
)

/**
 * Prisma's default interactive-transaction timeout is 5s. Stage 3
 * collapses chunk upserts to a single bulk INSERT, but the 30s ceiling
 * is preserved for safety against one-off pgvector planner regressions
 * on large fixture sets. Matches R1's scene indexer.
 */
const TRANSACTION_TIMEOUT_MS = 30_000

export type IndexEditionTranscriptInput = {
  editionId: string
  videoId: string
  coreId: string
  /** BCP-47 tag stamped on the new `VideoTranscript` row. */
  language: string
  user: Principal | null
  /**
   * Pre-loaded transcript chunks and vectors. Mastra ingest provides this
   * through `writeTranscriptEmbeddingPayload`; tests can also inject a
   * fixture without touching provider or S3 boundaries.
   */
  loadedArtifact: EmbeddingsResult
  provenance?: TranscriptEmbeddingProvenance
}

export type TranscriptEmbeddingGenerationMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export type TranscriptEmbeddingProvenance = {
  embeddingProvider?: string
  embeddingNativeDimensions?: number
  embeddingTransformVersion?: string
  sourceArtifactKey?: string
  sourceKind?: string
  sourceLanguageId?: string
  sourceLanguageSlug?: string
  sourceSubtitleId?: string
  sourceFormat?: string
  sourceUrl?: string
  sourceContentHash?: string
  sourceProvider?: string
  sourceGeneratedAt?: string
  generationMode?: TranscriptEmbeddingGenerationMode
  mastraRunId?: string
  chunkingVersion?: string
}

export type TranscriptEmbeddingPayloadChunk = {
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
}

export type TranscriptEmbeddingArtifactChunk = {
  chunkId: string
  text: string
  embedding: number[]
  rawSourceText?: string
  embeddingInputText?: string
  feltNeeds?: string[]
  bibleVerses?: string[]
  contentSummary?: string
  tone?: string
  demographics?: string[]
  spiritualContext?: string[]
  extractionMetadata?: Record<string, unknown>
  metadata: {
    tokenCount: number
    startTime?: number
    endTime?: number
  }
}

export type EmbeddingsResult = {
  model: string
  dimensions: number
  chunks: TranscriptEmbeddingArtifactChunk[]
  averagedEmbedding: number[]
  metadata: {
    totalChunks: number
    totalTokens: number
    chunkingStrategy: {
      type: "segment-aware" | "plain-text"
      maxChunkTokens: number
      overlapTokens: number
    }
    embeddingDimensions: number
    generatedAt: string
  }
}

export type TranscriptEmbeddingPayloadInput = {
  editionId: string
  videoId: string
  coreId: string
  language: string
  user: Principal | null
  model: string
  dimensions: number
  chunks: readonly TranscriptEmbeddingPayloadChunk[]
  chunking: {
    type: "segment-aware" | "plain-text"
    maxChunkTokens: number
    overlapTokens: number
  }
  totalTokens: number
  generatedAt: string
  provenance?: TranscriptEmbeddingProvenance
}

export type IndexEditionTranscriptResult = {
  editionId: string
  language: string
  chunksIndexed: number
  embeddingsWritten: number
  chunksPruned: number
  model: string
  dimensions: number
}

export type WriteTranscriptEmbeddingPayloadResult = IndexEditionTranscriptResult

export class TranscriptIndexError extends Error {
  constructor(
    readonly code:
      | "forbidden"
      | "dimension_mismatch"
      | "empty_chunk_text"
      | "storage_failed"
      | "artifact_invalid",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "TranscriptIndexError"
  }
}

// Chunk index uniqueness is not asserted: the indexer derives chunkIndex
// from the loop counter rather than the opaque `chunk.chunkId`, so
// duplicates are impossible by construction. Uniqueness of the upstream
// `chunkId` is not a contract admin enforces — it's manager-side
// bookkeeping that the artifact may reuse across re-chunks.

function assertDimensions(result: EmbeddingsResult): void {
  if (result.dimensions !== EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS) {
    throw new TranscriptIndexError(
      "dimension_mismatch",
      `artifact reports dimensions=${result.dimensions}; expected ${EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS}`,
    )
  }
  for (let i = 0; i < result.chunks.length; i += 1) {
    const chunk = result.chunks[i]!
    if (chunk.embedding.length !== EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS) {
      throw new TranscriptIndexError(
        "dimension_mismatch",
        `chunk ${i} has embedding length ${chunk.embedding.length}; expected ${EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS}`,
      )
    }
  }
}

function assertNonEmptyText(chunks: EmbeddingsResult["chunks"]): void {
  for (let i = 0; i < chunks.length; i += 1) {
    if (!chunks[i]!.text.trim()) {
      throw new TranscriptIndexError(
        "empty_chunk_text",
        `chunk ${i} has empty text; refusing to index`,
      )
    }
  }
}

function logModelStampDriftIfAny(artifactModel: string): void {
  if (ACCEPTED_TRANSCRIPT_EMBEDDING_MODEL_STAMPS.has(artifactModel)) return
  console.warn(
    JSON.stringify({
      event: "transcript_model_mismatch",
      artifactModel,
      expected: ACCEPTED_MODEL_STAMPS_LIST,
      note: "storing supplied vector; model upgrades require an explicit ingest mode",
    }),
  )
}

function assertContiguousChunkIndexes(
  chunks: readonly TranscriptEmbeddingPayloadChunk[],
): void {
  const seen = new Set<number>()
  for (const chunk of chunks) {
    if (seen.has(chunk.chunkIndex)) {
      throw new TranscriptIndexError(
        "artifact_invalid",
        `duplicate chunkIndex=${chunk.chunkIndex}; refusing to index`,
      )
    }
    seen.add(chunk.chunkIndex)
  }

  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i]!.chunkIndex !== i) {
      throw new TranscriptIndexError(
        "artifact_invalid",
        `chunk indexes must be contiguous from 0; expected ${i}, got ${sorted[i]!.chunkIndex}`,
      )
    }
  }
}

function toEmbeddingsResult(
  input: TranscriptEmbeddingPayloadInput,
): EmbeddingsResult {
  assertContiguousChunkIndexes(input.chunks)
  const chunks = [...input.chunks]
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((chunk) => ({
      chunkId: chunk.chunkId,
      text: chunk.text,
      embedding: chunk.embedding,
      rawSourceText: chunk.rawSourceText,
      embeddingInputText: chunk.embeddingInputText,
      feltNeeds: chunk.feltNeeds,
      bibleVerses: chunk.bibleVerses,
      contentSummary: chunk.contentSummary,
      tone: chunk.tone,
      demographics: chunk.demographics,
      spiritualContext: chunk.spiritualContext,
      extractionMetadata: chunk.extractionMetadata,
      metadata: {
        tokenCount: chunk.tokenCount,
        ...(chunk.startSeconds == null
          ? {}
          : { startTime: chunk.startSeconds }),
        ...(chunk.endSeconds == null ? {} : { endTime: chunk.endSeconds }),
      },
    }))

  return {
    model: input.model,
    dimensions: input.dimensions,
    chunks,
    averagedEmbedding: [],
    metadata: {
      totalChunks: chunks.length,
      totalTokens: input.totalTokens,
      chunkingStrategy: input.chunking,
      embeddingDimensions: input.dimensions,
      generatedAt: input.generatedAt,
    },
  }
}

function jsonToBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64")
}

export async function writeTranscriptEmbeddingPayload(
  prisma: PrismaClient,
  input: TranscriptEmbeddingPayloadInput,
): Promise<WriteTranscriptEmbeddingPayloadResult> {
  return indexEditionTranscript(prisma, {
    editionId: input.editionId,
    videoId: input.videoId,
    coreId: input.coreId,
    language: input.language,
    user: input.user,
    loadedArtifact: toEmbeddingsResult(input),
    provenance: input.provenance,
  })
}

export async function writeTranscriptEmbeddingPayloadInTransaction(
  tx: Prisma.TransactionClient,
  input: TranscriptEmbeddingPayloadInput,
): Promise<WriteTranscriptEmbeddingPayloadResult> {
  const txBackedClient = new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return async <T>(
          fn: (innerTx: Prisma.TransactionClient) => Promise<T>,
        ) => fn(tx)
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as unknown as PrismaClient

  return indexEditionTranscript(txBackedClient, {
    editionId: input.editionId,
    videoId: input.videoId,
    coreId: input.coreId,
    language: input.language,
    user: input.user,
    loadedArtifact: toEmbeddingsResult(input),
    provenance: input.provenance,
  })
}

/**
 * Index the transcript artifact for (editionId, language) from
 * manager's embeddings artifact. Writes `VideoTranscript` +
 * `VideoTranscriptChunk` rows and populates the embedding vector on
 * each chunk.
 */
export async function indexEditionTranscript(
  prisma: PrismaClient,
  input: IndexEditionTranscriptInput,
): Promise<IndexEditionTranscriptResult> {
  if (!canWriteDerived(input.user)) {
    throw new TranscriptIndexError(
      "forbidden",
      "Indexing transcript embeddings requires SYSTEM or ADMIN",
    )
  }

  const artifact = input.loadedArtifact

  if (artifact.chunks.length === 0) {
    return {
      editionId: input.editionId,
      language: input.language,
      chunksIndexed: 0,
      embeddingsWritten: 0,
      chunksPruned: 0,
      model: artifact.model,
      dimensions: artifact.dimensions,
    }
  }

  // Pre-validate synchronously BEFORE any DB write. Keeps reject
  // semantics coherent (same input, same complaint) and avoids partial
  // writes for an artifact we'd ultimately refuse.
  assertDimensions(artifact)
  assertNonEmptyText(artifact.chunks)
  logModelStampDriftIfAny(artifact.model)

  const incomingIndexes = artifact.chunks.map((_, i) => i)
  let embeddingsWritten = 0
  let chunksPruned = 0

  try {
    await prisma.$transaction(
      async (tx) => {
        // Upsert the parent artifact-metadata row. `create` + `update`
        // both refresh every artifact-level field so a manager re-run
        // propagates model/dimensions/chunking changes cleanly.
        const transcript = await tx.videoTranscript.upsert({
          where: {
            videoEditionId_language: {
              videoEditionId: input.editionId,
              language: input.language,
            },
          },
          create: {
            videoEditionId: input.editionId,
            videoId: input.videoId,
            language: input.language,
            model: artifact.model,
            dimensions: artifact.dimensions,
            ...(input.provenance?.embeddingProvider
              ? { embeddingProvider: input.provenance.embeddingProvider }
              : {}),
            ...(input.provenance?.embeddingNativeDimensions
              ? {
                  embeddingNativeDimensions:
                    input.provenance.embeddingNativeDimensions,
                }
              : {}),
            ...(input.provenance?.embeddingTransformVersion
              ? {
                  embeddingTransformVersion:
                    input.provenance.embeddingTransformVersion,
                }
              : {}),
            chunkingType: artifact.metadata.chunkingStrategy.type,
            maxChunkTokens: artifact.metadata.chunkingStrategy.maxChunkTokens,
            overlapTokens: artifact.metadata.chunkingStrategy.overlapTokens,
            totalChunks: artifact.metadata.totalChunks,
            totalTokens: artifact.metadata.totalTokens,
            generatedAt: new Date(artifact.metadata.generatedAt),
            ...(input.provenance?.sourceArtifactKey
              ? { sourceArtifactKey: input.provenance.sourceArtifactKey }
              : {}),
            ...(input.provenance?.sourceKind
              ? { sourceKind: input.provenance.sourceKind }
              : {}),
            ...(input.provenance?.sourceLanguageId
              ? { sourceLanguageId: input.provenance.sourceLanguageId }
              : {}),
            ...(input.provenance?.sourceLanguageSlug
              ? { sourceLanguageSlug: input.provenance.sourceLanguageSlug }
              : {}),
            ...(input.provenance?.sourceSubtitleId
              ? { sourceSubtitleId: input.provenance.sourceSubtitleId }
              : {}),
            ...(input.provenance?.sourceFormat
              ? { sourceFormat: input.provenance.sourceFormat }
              : {}),
            ...(input.provenance?.sourceUrl
              ? { sourceUrl: input.provenance.sourceUrl }
              : {}),
            ...(input.provenance?.sourceContentHash
              ? { sourceContentHash: input.provenance.sourceContentHash }
              : {}),
            ...(input.provenance?.sourceProvider
              ? { sourceProvider: input.provenance.sourceProvider }
              : {}),
            ...(input.provenance?.sourceGeneratedAt
              ? {
                  sourceGeneratedAt: new Date(
                    input.provenance.sourceGeneratedAt,
                  ),
                }
              : {}),
            ...(input.provenance?.generationMode
              ? { generationMode: input.provenance.generationMode }
              : {}),
            ...(input.provenance?.mastraRunId
              ? { mastraRunId: input.provenance.mastraRunId }
              : {}),
            ...(input.provenance?.chunkingVersion
              ? { chunkingVersion: input.provenance.chunkingVersion }
              : {}),
          },
          update: {
            // Refresh the denormalized `videoId` in case the edition has
            // moved between videos since the last index run. Upstream
            // edition moves are rare but silent drift here would mislead
            // `SELECT ... WHERE video_id = ?` consumers.
            videoId: input.videoId,
            model: artifact.model,
            dimensions: artifact.dimensions,
            embeddingProvider: input.provenance?.embeddingProvider ?? null,
            embeddingNativeDimensions:
              input.provenance?.embeddingNativeDimensions ?? null,
            embeddingTransformVersion:
              input.provenance?.embeddingTransformVersion ?? null,
            chunkingType: artifact.metadata.chunkingStrategy.type,
            maxChunkTokens: artifact.metadata.chunkingStrategy.maxChunkTokens,
            overlapTokens: artifact.metadata.chunkingStrategy.overlapTokens,
            totalChunks: artifact.metadata.totalChunks,
            totalTokens: artifact.metadata.totalTokens,
            generatedAt: new Date(artifact.metadata.generatedAt),
            sourceArtifactKey: input.provenance?.sourceArtifactKey ?? null,
            sourceKind: input.provenance?.sourceKind ?? null,
            sourceLanguageId: input.provenance?.sourceLanguageId ?? null,
            sourceLanguageSlug: input.provenance?.sourceLanguageSlug ?? null,
            sourceSubtitleId: input.provenance?.sourceSubtitleId ?? null,
            sourceFormat: input.provenance?.sourceFormat ?? null,
            sourceUrl: input.provenance?.sourceUrl ?? null,
            sourceContentHash: input.provenance?.sourceContentHash ?? null,
            sourceProvider: input.provenance?.sourceProvider ?? null,
            sourceGeneratedAt: input.provenance?.sourceGeneratedAt
              ? new Date(input.provenance.sourceGeneratedAt)
              : null,
            generationMode: input.provenance?.generationMode ?? null,
            mastraRunId: input.provenance?.mastraRunId ?? null,
            chunkingVersion: input.provenance?.chunkingVersion ?? null,
          },
          select: { id: true },
        })

        // Prune orphan chunks from any previous run with more chunks.
        // Bounded to this transcript's children; other transcripts
        // (different edition×language) untouched. Happens before the
        // upserts so the idempotent-rerun path stays the same.
        const pruneResult = await tx.videoTranscriptChunk.deleteMany({
          where: {
            transcriptId: transcript.id,
            chunkIndex: { notIn: incomingIndexes },
          },
        })
        chunksPruned = pruneResult.count

        // ─── Stage 3 (feat-117) — Bulk chunk INSERT … ON CONFLICT … DO UPDATE ─
        // Build parallel arrays. text[] params unfold via
        // `u.<col>::<type>` per-row casts at the SELECT seam (Way A
        // discipline). The vector cast lives on the SELECT seam too —
        // `u.embedding_text::vector(1536)` — NOT `::vector(1536)[]` on
        // the parameter (the array-input parser is less-trodden code;
        // single-row casts are documented and well-exercised).
        const ids = artifact.chunks.map(() => randomUUID())
        const transcriptIds = artifact.chunks.map(() => transcript.id)
        const languages = artifact.chunks.map(() => input.language)
        const chunkIndexes = artifact.chunks.map((_, i) => String(i))
        const chunkIds = artifact.chunks.map((c) => c.chunkId)
        const texts = artifact.chunks.map((c) => c.text)
        const rawSourceTexts = artifact.chunks.map(
          (c) => c.rawSourceText ?? null,
        )
        const embeddingInputTexts = artifact.chunks.map(
          (c) => c.embeddingInputText ?? null,
        )
        const feltNeedsJson = artifact.chunks.map((c) =>
          JSON.stringify(c.feltNeeds ?? []),
        )
        const bibleVersesJson = artifact.chunks.map((c) =>
          JSON.stringify(c.bibleVerses ?? []),
        )
        const contentSummaries = artifact.chunks.map(
          (c) => c.contentSummary ?? null,
        )
        const tones = artifact.chunks.map((c) => c.tone ?? null)
        const demographicsJson = artifact.chunks.map((c) =>
          JSON.stringify(c.demographics ?? []),
        )
        const spiritualContextJson = artifact.chunks.map((c) =>
          JSON.stringify(c.spiritualContext ?? []),
        )
        const extractionMetadataBase64 = artifact.chunks.map((c) =>
          c.extractionMetadata == null
            ? null
            : jsonToBase64(c.extractionMetadata),
        )
        const tokenCounts = artifact.chunks.map((c) =>
          String(c.metadata.tokenCount),
        )
        const startSeconds = artifact.chunks.map((c) =>
          c.metadata.startTime == null ? null : String(c.metadata.startTime),
        )
        const endSeconds = artifact.chunks.map((c) =>
          c.metadata.endTime == null ? null : String(c.metadata.endTime),
        )
        const models = artifact.chunks.map(() => artifact.model)
        const dimensionsArr = artifact.chunks.map(() =>
          String(artifact.dimensions),
        )
        const vectorTexts = artifact.chunks.map((c) => toPgVector(c.embedding))

        assertParallelArrayLengthsMatch(
          artifact.chunks.length,
          [
            { name: "ids", length: ids.length },
            { name: "transcriptIds", length: transcriptIds.length },
            { name: "languages", length: languages.length },
            { name: "chunkIndexes", length: chunkIndexes.length },
            { name: "chunkIds", length: chunkIds.length },
            { name: "texts", length: texts.length },
            { name: "rawSourceTexts", length: rawSourceTexts.length },
            {
              name: "embeddingInputTexts",
              length: embeddingInputTexts.length,
            },
            { name: "feltNeedsJson", length: feltNeedsJson.length },
            { name: "bibleVersesJson", length: bibleVersesJson.length },
            { name: "contentSummaries", length: contentSummaries.length },
            { name: "tones", length: tones.length },
            { name: "demographicsJson", length: demographicsJson.length },
            {
              name: "spiritualContextJson",
              length: spiritualContextJson.length,
            },
            {
              name: "extractionMetadataBase64",
              length: extractionMetadataBase64.length,
            },
            { name: "tokenCounts", length: tokenCounts.length },
            { name: "startSeconds", length: startSeconds.length },
            { name: "endSeconds", length: endSeconds.length },
            { name: "models", length: models.length },
            { name: "dimensionsArr", length: dimensionsArr.length },
            { name: "vectorTexts", length: vectorTexts.length },
          ],
          (msg) =>
            new TranscriptIndexError(
              "artifact_invalid",
              `internal: ${msg} (transcript chunk INSERT)`,
            ),
        )

        const writeAffected = await tx.$executeRaw`
          INSERT INTO video_transcript_chunk (
            id, transcript_id, language, chunk_index, chunk_id,
            text, raw_source_text, embedding_input_text,
            felt_needs, bible_verses, content_summary, tone,
            demographics, spiritual_context, extraction_metadata,
            token_count, start_seconds, end_seconds,
            model, dimensions, embedding,
            created_at, updated_at
          )
          SELECT
            u.id,
            u.transcript_id,
            u.language,
            u.chunk_index::int,
            u.chunk_id,
            u.text,
            u.raw_source_text,
            u.embedding_input_text,
            ARRAY(SELECT jsonb_array_elements_text(u.felt_needs_json::jsonb)),
            ARRAY(SELECT jsonb_array_elements_text(u.bible_verses_json::jsonb)),
            u.content_summary,
            u.tone,
            ARRAY(SELECT jsonb_array_elements_text(u.demographics_json::jsonb)),
            ARRAY(SELECT jsonb_array_elements_text(u.spiritual_context_json::jsonb)),
            CASE
              WHEN u.extraction_metadata_base64 IS NULL THEN NULL
              ELSE convert_from(decode(u.extraction_metadata_base64, 'base64'), 'UTF8')::jsonb
            END,
            u.token_count::int,
            u.start_seconds::double precision,
            u.end_seconds::double precision,
            u.model,
            u.dimensions::int,
            u.embedding_text::vector(1536),
            NOW(),
            NOW()
          FROM unnest(
            ${toPgArray(ids)}::text[],
            ${toPgArray(transcriptIds)}::text[],
            ${toPgArray(languages)}::text[],
            ${toPgArray(chunkIndexes)}::text[],
            ${toPgArray(chunkIds)}::text[],
            ${toPgArray(texts)}::text[],
            ${toPgArray(rawSourceTexts)}::text[],
            ${toPgArray(embeddingInputTexts)}::text[],
            ${toPgArray(feltNeedsJson)}::text[],
            ${toPgArray(bibleVersesJson)}::text[],
            ${toPgArray(contentSummaries)}::text[],
            ${toPgArray(tones)}::text[],
            ${toPgArray(demographicsJson)}::text[],
            ${toPgArray(spiritualContextJson)}::text[],
            ${toPgArray(extractionMetadataBase64)}::text[],
            ${toPgArray(tokenCounts)}::text[],
            ${toPgArray(startSeconds)}::text[],
            ${toPgArray(endSeconds)}::text[],
            ${toPgArray(models)}::text[],
            ${toPgArray(dimensionsArr)}::text[],
            ${toPgArray(vectorTexts)}::text[]
          ) AS u(
            id, transcript_id, language, chunk_index, chunk_id,
            text, raw_source_text, embedding_input_text,
            felt_needs_json, bible_verses_json, content_summary, tone,
            demographics_json, spiritual_context_json, extraction_metadata_base64,
            token_count, start_seconds, end_seconds,
            model, dimensions, embedding_text
          )
          ON CONFLICT (transcript_id, chunk_index)
          DO UPDATE SET
            language      = EXCLUDED.language,
            chunk_id      = EXCLUDED.chunk_id,
            text          = EXCLUDED.text,
            raw_source_text = EXCLUDED.raw_source_text,
            embedding_input_text = EXCLUDED.embedding_input_text,
            felt_needs    = EXCLUDED.felt_needs,
            bible_verses  = EXCLUDED.bible_verses,
            content_summary = EXCLUDED.content_summary,
            tone          = EXCLUDED.tone,
            demographics  = EXCLUDED.demographics,
            spiritual_context = EXCLUDED.spiritual_context,
            extraction_metadata = EXCLUDED.extraction_metadata,
            token_count   = EXCLUDED.token_count,
            start_seconds = EXCLUDED.start_seconds,
            end_seconds   = EXCLUDED.end_seconds,
            model         = EXCLUDED.model,
            dimensions    = EXCLUDED.dimensions,
            embedding     = EXCLUDED.embedding,
            updated_at    = NOW()
        `
        embeddingsWritten = Number(writeAffected)
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    )
  } catch (error) {
    // Remap Prisma runtime errors so their raw `message` (which on
    // $executeRaw failures includes the bound vector literal) does NOT
    // round-trip into the workflow's `outcome.reason` and out the
    // GraphQL mutation response. Non-Prisma errors propagate unchanged.
    if (isPrismaRuntimeError(error)) {
      // Log the raw detail server-side only (Railway logs).
      console.error(
        JSON.stringify({
          event: "transcript_index_storage_error",
          editionId: input.editionId,
          language: input.language,
          name: (error as { name?: unknown }).name,
          code: (error as { code?: unknown }).code,
          // Deliberately truncated: the first 200 chars of the raw
          // message are enough to identify the query shape without
          // leaking the full vector parameter.
          messagePreview:
            error instanceof Error ? error.message.slice(0, 200) : undefined,
        }),
      )
      throw new TranscriptIndexError(
        "storage_failed",
        sanitizePrismaErrorMessage(error, "transcript-embedding write"),
        error,
      )
    }
    throw error
  }

  return {
    editionId: input.editionId,
    language: input.language,
    chunksIndexed: artifact.chunks.length,
    embeddingsWritten,
    chunksPruned,
    model: artifact.model,
    dimensions: artifact.dimensions,
  }
}
