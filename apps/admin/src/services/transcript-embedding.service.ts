// Transcript embedding indexer — reads manager's embeddings artifacts
// from S3 and writes VideoTranscript + VideoTranscriptChunk rows into
// admin's Postgres with vectors copied verbatim from the artifact.
//
// Source: apps/manager's `{assetId}/embeddings.json`. assetId is the
// integer cms videos.id as a string; admin resolves Video.coreId →
// cmsVideoId via the mapping loaded by core-id-mapping.service.ts.
//
// R2 DIVERGENCE FROM R1: manager already called the embedding provider
// during enrichment and stored each chunk's vector in the artifact. R2
// trusts those vectors — no OpenRouter round-trip, no regeneration.
// See docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md.
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
// video_transcript_chunk … SELECT * FROM unnest(9 parallel arrays)
// ON CONFLICT (transcript_id, chunk_index) DO UPDATE`. Per-row Way A
// `::vector(1536)` cast at the SELECT seam (NOT a `::vector(1536)[]`
// parameter cast — that array-input parser is less-trodden code; Way A
// keeps the cast at one site per row). See
// docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md.

import { randomUUID } from "node:crypto"

import { type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { canWriteDerived } from "@/auth/permissions"
import { toPgArray, toPgVector } from "@/db/pgvector"
import {
  readEmbeddingsArtifact,
  type EmbeddingsResult,
} from "@/services/manager-artifacts.service"

/**
 * Admin stores `text-embedding-3-small` vectors at 1536 dimensions
 * across experiences, scenes, and transcripts. Artifacts with a
 * different dimension count are rejected as invalid rather than
 * silently truncated or padded.
 */
export const EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS = 1536

/**
 * Admin's expected embedding model. Manager may report the OpenRouter-
 * prefixed name (`openai/text-embedding-3-small`) or the bare OpenAI
 * name; both are accepted. A mismatch is logged as a warning but does
 * not reject the artifact — R2's whole premise is reusing manager's
 * vectors as-is.
 */
const ACCEPTED_MODEL_STAMPS = new Set<string>([
  "openai/text-embedding-3-small",
  "text-embedding-3-small",
])

// Precomputed list form for the drift-warning log payload. Avoids
// re-serializing the Set on every mismatch.
const ACCEPTED_MODEL_STAMPS_LIST = Array.from(ACCEPTED_MODEL_STAMPS)

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
   * Pre-loaded embeddings artifact. When provided, the service skips
   * the S3 read. Stage 2 of the embed-backfill performance plan: the
   * workflow fetches once per (video, edition) group and passes the
   * same artifact into each per-language invocation — collapsing S3
   * reads from N×L to N. Tests can also use this to inject a fixture
   * without touching S3.
   */
  loadedArtifact?: EmbeddingsResult
  /** Override for tests — use this cmsVideoId instead of the mapping lookup. */
  cmsVideoIdOverride?: number
  /** Required when `loadedArtifact` is not set. */
  cmsVideoId?: number
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

export class TranscriptIndexError extends Error {
  constructor(
    readonly code:
      | "forbidden"
      | "missing_cms_video_id"
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

/**
 * Prisma raw SQL errors (especially `$executeRaw` failures on vector
 * writes) can surface the full statement text and parameter values in
 * `error.message`. Our vector literal is a 1536-element float string;
 * letting it round-trip through `outcome.reason` in the workflow and
 * out the GraphQL mutation response would leak the vector into the
 * caller's payload. Mirrors the zod-echo hardening already applied to
 * `readEmbeddingsArtifact` —
 * see docs/solutions/best-practices/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md.
 *
 * Detection is shape-based rather than `instanceof`-based because the
 * Prisma error class tree differs across runtime/dev and we don't
 * want to import @prisma/client at the service boundary just to
 * `instanceof` a specific subclass. `code` / `meta` presence is
 * stable across Prisma 6.x.
 */
function isPrismaRuntimeError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const err = error as { name?: unknown; code?: unknown }
  if (typeof err.name === "string" && err.name.startsWith("PrismaClient")) {
    return true
  }
  // Prisma P-codes (P2002, P2025, etc.) are the engine's stable
  // error code surface. Any P-prefixed string is a Prisma error.
  if (typeof err.code === "string" && /^P\d{4}$/.test(err.code)) {
    return true
  }
  return false
}

function sanitizePrismaErrorMessage(error: unknown): string {
  const name =
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "PrismaError"
  const code =
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "unknown"
  // Explicitly do NOT include error.message — it can carry the raw
  // SQL statement with a bound vector literal.
  return `${name}(${code}) during transcript-embedding write`
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
  if (ACCEPTED_MODEL_STAMPS.has(artifactModel)) return
  console.warn(
    JSON.stringify({
      event: "transcript_model_mismatch",
      artifactModel,
      expected: ACCEPTED_MODEL_STAMPS_LIST,
      note: "reusing vector regardless; re-embedding is R2 scope-out",
    }),
  )
}

/**
 * Length-equality preflight. PostgreSQL 18's `unnest(arr1, arr2, ...)`
 * silently NULL-pads unequal-length arrays — a regression that drops a
 * row from a parallel-array bind would corrupt the INSERT without
 * raising. Throwing BEFORE `$executeRaw` makes the bug visible at the
 * call site rather than at downstream read time.
 */
function assertParallelArrayLengthsMatch(
  expected: number,
  arrays: ReadonlyArray<{ name: string; length: number }>,
): void {
  for (const arr of arrays) {
    if (arr.length !== expected) {
      throw new TranscriptIndexError(
        "artifact_invalid",
        `internal: parallel-array length mismatch in transcript chunk bulk INSERT (expected=${expected}, ${arr.name}=${arr.length})`,
      )
    }
  }
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

  let artifact: EmbeddingsResult
  if (input.loadedArtifact !== undefined) {
    artifact = input.loadedArtifact
  } else {
    const cmsVideoId = input.cmsVideoIdOverride ?? input.cmsVideoId
    if (cmsVideoId === undefined) {
      throw new TranscriptIndexError(
        "missing_cms_video_id",
        `cmsVideoId is required to fetch the embeddings artifact for coreId=${input.coreId}`,
      )
    }
    artifact = await readEmbeddingsArtifact(String(cmsVideoId))
  }

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
            chunkingType: artifact.metadata.chunkingStrategy.type,
            maxChunkTokens: artifact.metadata.chunkingStrategy.maxChunkTokens,
            overlapTokens: artifact.metadata.chunkingStrategy.overlapTokens,
            totalChunks: artifact.metadata.totalChunks,
            totalTokens: artifact.metadata.totalTokens,
            generatedAt: new Date(artifact.metadata.generatedAt),
          },
          update: {
            // Refresh the denormalized `videoId` in case the edition has
            // moved between videos since the last index run. Upstream
            // edition moves are rare but silent drift here would mislead
            // `SELECT ... WHERE video_id = ?` consumers.
            videoId: input.videoId,
            model: artifact.model,
            dimensions: artifact.dimensions,
            chunkingType: artifact.metadata.chunkingStrategy.type,
            maxChunkTokens: artifact.metadata.chunkingStrategy.maxChunkTokens,
            overlapTokens: artifact.metadata.chunkingStrategy.overlapTokens,
            totalChunks: artifact.metadata.totalChunks,
            totalTokens: artifact.metadata.totalTokens,
            generatedAt: new Date(artifact.metadata.generatedAt),
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
        // Build 12 parallel arrays. text[] params unfold via
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

        assertParallelArrayLengthsMatch(artifact.chunks.length, [
          { name: "ids", length: ids.length },
          { name: "transcriptIds", length: transcriptIds.length },
          { name: "languages", length: languages.length },
          { name: "chunkIndexes", length: chunkIndexes.length },
          { name: "chunkIds", length: chunkIds.length },
          { name: "texts", length: texts.length },
          { name: "tokenCounts", length: tokenCounts.length },
          { name: "startSeconds", length: startSeconds.length },
          { name: "endSeconds", length: endSeconds.length },
          { name: "models", length: models.length },
          { name: "dimensionsArr", length: dimensionsArr.length },
          { name: "vectorTexts", length: vectorTexts.length },
        ])

        const writeAffected = await tx.$executeRaw`
          INSERT INTO video_transcript_chunk (
            id, transcript_id, language, chunk_index, chunk_id,
            text, token_count, start_seconds, end_seconds,
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
            ${toPgArray(tokenCounts)}::text[],
            ${toPgArray(startSeconds)}::text[],
            ${toPgArray(endSeconds)}::text[],
            ${toPgArray(models)}::text[],
            ${toPgArray(dimensionsArr)}::text[],
            ${toPgArray(vectorTexts)}::text[]
          ) AS u(
            id, transcript_id, language, chunk_index, chunk_id,
            text, token_count, start_seconds, end_seconds,
            model, dimensions, embedding_text
          )
          ON CONFLICT (transcript_id, chunk_index)
          DO UPDATE SET
            language      = EXCLUDED.language,
            chunk_id      = EXCLUDED.chunk_id,
            text          = EXCLUDED.text,
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
        sanitizePrismaErrorMessage(error),
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
