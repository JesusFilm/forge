// Manager artifact reader — downloads scene-analysis.json,
// transcript.json, and legacy embeddings.json artifacts from
// manager's Railway S3 bucket (MANAGER_ARTIFACTS_S3_*) and
// Zod-validates against the expected shape before returning.
//
// R1 (scene embeddings) reads `{assetId}/scene-analysis.json` and
// regenerates vectors in admin.
// R2 legacy transcript embeddings read `{assetId}/embeddings.json`.
// feat-132 transcript embeddings read `{assetId}/transcript.json` and
// launch Mastra; Admin no longer imports manager-generated transcript vectors.
//
// Source references (shapes mirrored here):
//   apps/manager/src/services/sceneAnalysis.ts (scene-analysis write)
//   apps/manager/src/services/sceneEmbeddingSync.ts (scene-analysis read)
//   apps/manager/src/services/transcription.ts (transcript write)

import { z } from "zod"
import { readManagerArtifact } from "@/storage/s3"

export const SceneAnalysisSchema = z
  .object({
    sceneIndex: z.number().int().nonnegative(),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nullable().optional(),
    chapterTitle: z.string().nullable().optional(),
    description: z.string(),
    themes: z.array(z.string()),
    bibleVerses: z.array(z.string()),
    demographics: z.array(z.string()),
    spiritualContext: z.array(z.string()),
  })
  .strict()

export const SceneAnalysisResultSchema = z
  .object({
    scenes: z.array(SceneAnalysisSchema),
    totalInputTokens: z.number().finite().optional(),
    totalOutputTokens: z.number().finite().optional(),
  })
  .passthrough()

export type SceneAnalysis = z.infer<typeof SceneAnalysisSchema>
export type SceneAnalysisResult = z.infer<typeof SceneAnalysisResultSchema>

export const TranscriptSourceSegmentSchema = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    text: z.string(),
  })
  .strict()

export const TranscriptSourceArtifactSchema = z
  .object({
    text: z.string(),
    segments: z.array(TranscriptSourceSegmentSchema),
    language: z.string().min(1),
    resolvedProvider: z.enum(["elevenlabs", "mux"]).optional(),
    routingReport: z.unknown().optional(),
  })
  .passthrough()

export type TranscriptSourceArtifact = z.infer<
  typeof TranscriptSourceArtifactSchema
>

export class ManagerArtifactError extends Error {
  constructor(
    readonly code:
      | "artifact_missing"
      | "artifact_invalid"
      | "artifact_read_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ManagerArtifactError"
  }
}

/**
 * Decide whether a thrown error from `readManagerArtifact` represents a
 * genuinely-missing artifact (manager hasn't enriched this asset yet)
 * vs an actual transport / config failure.
 *
 * Order matters: typed surface FIRST (stable across AWS SDK message
 * rewordings — historically AWS has rephrased the textual NoSuchKey
 * message at least once), regex backstop SECOND (covers local-fallback
 * `ENOENT` and any future alt-storage backends that don't carry an AWS
 * SDK-typed shape).
 *
 * The regex is deliberately TIGHT — narrower than the legacy
 * `/not found|missing|no such key|ENOENT|NoSuchKey/i` it replaces.
 * Tokens dropped:
 *   - `NoSuchKey` / `no such key`: typed branch above covers AWS SDK
 *     verbatim; the regex would over-match unrelated S3-shaped errors.
 *   - `missing` (bare): too loose — matches "missing field 'foo'" and
 *     other unrelated bug messages, mis-demoting real failures to
 *     skipped. The remaining tokens (`not found`, `does not exist`,
 *     `ENOENT`) are specific enough that no observed-in-practice error
 *     message has been mis-classified.
 *
 * Tests must throw the REAL typed shape (`Object.assign(new Error(...),
 * { name: "NoSuchKey" })`), not a generic `new Error("NoSuchKey: ...")`
 * — otherwise the regex backstop satisfies the test while the typed
 * branch stays untested, which is the trap captured in
 * `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`
 * generalized to mocks. See also
 * `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`.
 */
function isArtifactMissing(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name
    if (name === "NoSuchKey" || name === "NotFound") return true
    const code = (error as { Code?: unknown }).Code
    if (code === "NoSuchKey" || code === "NotFound") return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /not found|does not exist|ENOENT/i.test(message)
}

/**
 * Read a scene-analysis artifact from manager's Railway S3 bucket
 * (MANAGER_ARTIFACTS_S3_*) or local
 * `.tmp/artifacts/{assetId}/scene-analysis.json` fallback and return
 * the parsed, Zod-validated result.
 *
 * @param assetId  The integer cms video id as a string — this is the
 *                 key manager used when writing the artifact. Admin's
 *                 Video.coreId must be mapped to this via the core-id
 *                 mapping file before calling.
 */
export async function readSceneAnalysisArtifact(
  assetId: string,
): Promise<SceneAnalysisResult> {
  let bytes: Uint8Array
  try {
    bytes = await readManagerArtifact(assetId, "scene-analysis", "json")
  } catch (error) {
    if (isArtifactMissing(error)) {
      throw new ManagerArtifactError(
        "artifact_missing",
        `scene-analysis artifact not found for assetId=${assetId}`,
        error,
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new ManagerArtifactError(
      "artifact_read_failed",
      `failed to read scene-analysis artifact for assetId=${assetId}: ${message}`,
      error,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `scene-analysis artifact for assetId=${assetId} is not valid JSON`,
      error,
    )
  }

  const parsed = SceneAnalysisResultSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `scene-analysis artifact for assetId=${assetId} failed schema validation: ${parsed.error.message}`,
      parsed.error,
    )
  }

  return parsed.data
}

export async function readTranscriptSourceArtifact(
  assetId: string,
): Promise<TranscriptSourceArtifact> {
  let bytes: Uint8Array
  try {
    bytes = await readManagerArtifact(assetId, "transcript", "json")
  } catch (error) {
    if (isArtifactMissing(error)) {
      throw new ManagerArtifactError(
        "artifact_missing",
        `transcript artifact not found for assetId=${assetId}`,
        error,
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new ManagerArtifactError(
      "artifact_read_failed",
      `failed to read transcript artifact for assetId=${assetId}: ${message}`,
      error,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `transcript artifact for assetId=${assetId} is not valid JSON`,
      error,
    )
  }

  const parsed = TranscriptSourceArtifactSchema.safeParse(raw)
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        event: "transcript_artifact_invalid",
        assetId,
        zodMessage: parsed.error.message,
      }),
    )
    throw new ManagerArtifactError(
      "artifact_invalid",
      `transcript artifact for assetId=${assetId} failed schema validation`,
      parsed.error,
    )
  }

  return parsed.data
}

// -----------------------------------------------------------------------------
// Embeddings artifact (R2 — transcript embeddings)
// -----------------------------------------------------------------------------

/**
 * The transcript-chunk shape admin consumes. Matches
 * `apps/manager/src/services/embeddings.ts::EmbeddingChunk`:
 *   - `chunkId`: opaque stable identifier from manager's chunker.
 *   - `text`: the exact text manager embedded.
 *   - `embedding`: vector(1536) — trust-and-copy into admin's pgvector.
 *   - `metadata`: token count + optional segment-aware timecodes.
 *
 * `.strict()` because a drift in chunk shape would corrupt vector
 * storage — better to fail fast with `artifact_invalid` than to
 * silently drop fields.
 */
export const EmbeddingsChunkSchema = z
  .object({
    chunkId: z.string().min(1),
    text: z.string().min(1),
    embedding: z
      .array(z.number().finite())
      .min(1)
      .describe(
        "Chunk embedding vector; length must match top-level dimensions",
      ),
    metadata: z
      .object({
        tokenCount: z.number().int().nonnegative(),
        startTime: z.number().finite().optional(),
        endTime: z.number().finite().optional(),
      })
      .strict(),
  })
  .strict()

export const EmbeddingsChunkingStrategySchema = z
  .object({
    type: z.enum(["segment-aware", "plain-text"]),
    maxChunkTokens: z.number().int().positive(),
    overlapTokens: z.number().int().nonnegative(),
  })
  .strict()

/**
 * Admin's view of manager's `EmbeddingsResult`. Top-level
 * `.passthrough()` tolerates future manager-side additions
 * (metadataEmbedding, artifactKeys); chunks use `.strict()` because
 * a drift there would land corrupt vectors.
 */
export const EmbeddingsResultSchema = z
  .object({
    model: z.string().min(1),
    dimensions: z.number().int().positive(),
    chunks: z.array(EmbeddingsChunkSchema),
    averagedEmbedding: z.array(z.number().finite()),
    metadata: z
      .object({
        totalChunks: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
        chunkingStrategy: EmbeddingsChunkingStrategySchema,
        embeddingDimensions: z.number().int().positive(),
        generatedAt: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough()

export type EmbeddingsChunk = z.infer<typeof EmbeddingsChunkSchema>
export type EmbeddingsResult = z.infer<typeof EmbeddingsResultSchema>

/**
 * Read an embeddings artifact from manager's Railway S3 bucket
 * (MANAGER_ARTIFACTS_S3_*) or local
 * `.tmp/artifacts/{assetId}/embeddings.json` fallback and return
 * the parsed, Zod-validated result. Vectors inside
 * `chunks[].embedding` are the authoritative source that R2's
 * transcript-embedding indexer copies into admin's Postgres — no
 * provider call is made during R2 backfill.
 *
 * @param assetId  The integer cms video id as a string — this is the
 *                 key manager used when writing the artifact. Admin's
 *                 Video.coreId must be mapped to this via the core-id
 *                 mapping file before calling.
 */
export async function readEmbeddingsArtifact(
  assetId: string,
): Promise<EmbeddingsResult> {
  let bytes: Uint8Array
  try {
    bytes = await readManagerArtifact(assetId, "embeddings", "json")
  } catch (error) {
    if (isArtifactMissing(error)) {
      throw new ManagerArtifactError(
        "artifact_missing",
        `embeddings artifact not found for assetId=${assetId}`,
        error,
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new ManagerArtifactError(
      "artifact_read_failed",
      `failed to read embeddings artifact for assetId=${assetId}: ${message}`,
      error,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new ManagerArtifactError(
      "artifact_invalid",
      `embeddings artifact for assetId=${assetId} is not valid JSON`,
      error,
    )
  }

  const parsed = EmbeddingsResultSchema.safeParse(raw)
  if (!parsed.success) {
    // Do NOT echo the Zod error message in the thrown error — it can
    // contain chunk text or embedding floats from the artifact, which
    // is effectively user-controlled input for any operator-visible
    // surface. Log server-side; return a stable generic message.
    // See docs/solutions/best-practices/zod-validation-errors-must-not-echo-user-controlled-input-20260420.md.
    console.error(
      JSON.stringify({
        event: "embeddings_artifact_invalid",
        assetId,
        zodMessage: parsed.error.message,
      }),
    )
    throw new ManagerArtifactError(
      "artifact_invalid",
      `embeddings artifact for assetId=${assetId} failed schema validation`,
      parsed.error,
    )
  }

  return parsed.data
}
