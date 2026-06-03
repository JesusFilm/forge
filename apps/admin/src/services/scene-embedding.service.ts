// Scene embedding storage writer. Mastra owns scene embedding generation and
// provider calls; Admin owns validation-adjacent storage, pgvector writes, and
// search retrieval.

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

/**
 * Admin stores `text-embedding-3-small` vectors at 1536 dimensions across
 * experiences, scenes, and transcripts. Scene ingest rejects any drift before
 * this writer touches Postgres.
 */
export const EXPECTED_SCENE_EMBEDDING_DIMENSIONS = 1536

/**
 * Prisma's default interactive-transaction timeout is 5s. The scene bulk write
 * is constant-round-trip, but the 30s ceiling is preserved for safety against
 * one-off pgvector planner regressions on large fixture sets.
 */
const TRANSACTION_TIMEOUT_MS = 30_000

export type SceneEmbeddingGenerationMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export type SceneEmbeddingProvenance = {
  embeddingProvider?: string
  embeddingNativeDimensions?: number
  embeddingTransformVersion?: string
  sourceArtifactKey?: string
  sourceArtifactVersion?: string
  sourceContentHash?: string
  sourceProvider?: string
  sourceGeneratedAt?: string
  generationMode?: SceneEmbeddingGenerationMode
  mastraRunId?: string
  generatedAt?: string
}

export type SceneEmbeddingPayloadScene = {
  sceneIndex: number
  startSeconds: number
  endSeconds?: number
  chapterTitle?: string
  sourceText: string
  description: string
  themes?: readonly string[]
  bibleVerses?: readonly string[]
  demographics?: readonly string[]
  spiritualContext?: readonly string[]
  embedding: readonly number[]
}

export type SceneEmbeddingPayloadInput = {
  editionId: string
  videoId: string
  coreId: string
  locale: string
  user: Principal | null
  model: string
  dimensions: number
  scenes: readonly SceneEmbeddingPayloadScene[]
  provenance?: SceneEmbeddingProvenance
}

export type WriteSceneEmbeddingPayloadResult = {
  editionId: string
  locale: string
  scenesIndexed: number
  embeddingsWritten: number
  scenesPruned: number
  model: string
  dimensions: number
}

export class SceneIndexError extends Error {
  constructor(
    readonly code:
      | "forbidden"
      | "dimension_mismatch"
      | "duplicate_scene_index"
      | "empty_description"
      | "artifact_invalid"
      | "storage_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SceneIndexError"
  }
}

function assertNoDuplicateSceneIndexes(
  scenes: readonly SceneEmbeddingPayloadScene[],
): void {
  const seen = new Set<number>()
  for (const scene of scenes) {
    if (seen.has(scene.sceneIndex)) {
      throw new SceneIndexError(
        "duplicate_scene_index",
        `scene_index ${scene.sceneIndex} appears more than once in the payload`,
      )
    }
    seen.add(scene.sceneIndex)
  }
}

function assertDimensions(input: SceneEmbeddingPayloadInput): void {
  if (input.dimensions !== EXPECTED_SCENE_EMBEDDING_DIMENSIONS) {
    throw new SceneIndexError(
      "dimension_mismatch",
      `payload reports dimensions=${input.dimensions}; expected ${EXPECTED_SCENE_EMBEDDING_DIMENSIONS}`,
    )
  }

  for (const scene of input.scenes) {
    if (scene.embedding.length !== EXPECTED_SCENE_EMBEDDING_DIMENSIONS) {
      throw new SceneIndexError(
        "dimension_mismatch",
        `scene ${scene.sceneIndex} has embedding length ${scene.embedding.length}; expected ${EXPECTED_SCENE_EMBEDDING_DIMENSIONS}`,
      )
    }
  }
}

function assertSceneContent(input: SceneEmbeddingPayloadInput): void {
  for (const scene of input.scenes) {
    if (!scene.sourceText.trim() || !scene.description.trim()) {
      throw new SceneIndexError(
        "empty_description",
        `scene ${scene.sceneIndex} has empty source text or description; refusing to index`,
      )
    }
    if (scene.endSeconds != null && scene.endSeconds < scene.startSeconds) {
      throw new SceneIndexError(
        "artifact_invalid",
        `scene ${scene.sceneIndex} has endSeconds before startSeconds`,
      )
    }
  }
}

/**
 * Map each prepared scene to its parent `video_scene.id` via the
 * `scene_index -> id` map produced by the post-INSERT recovery SELECT.
 */
function resolveVideoSceneIds(
  prepared: readonly { scene: SceneEmbeddingPayloadScene }[],
  sceneIndexToId: ReadonlyMap<number, string>,
): string[] {
  return prepared.map((p) => {
    const id = sceneIndexToId.get(p.scene.sceneIndex)
    if (id === undefined) {
      throw new SceneIndexError(
        "artifact_invalid",
        `parent video_scene id not found for scene_index=${p.scene.sceneIndex} after bulk INSERT`,
      )
    }
    return id
  })
}

export async function writeSceneEmbeddingPayload(
  prisma: PrismaClient,
  input: SceneEmbeddingPayloadInput,
): Promise<WriteSceneEmbeddingPayloadResult> {
  return writeSceneEmbeddingPayloadWithClient(prisma, input)
}

export async function writeSceneEmbeddingPayloadInTransaction(
  tx: Prisma.TransactionClient,
  input: SceneEmbeddingPayloadInput,
): Promise<WriteSceneEmbeddingPayloadResult> {
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

  return writeSceneEmbeddingPayloadWithClient(txBackedClient, input)
}

async function writeSceneEmbeddingPayloadWithClient(
  prisma: PrismaClient,
  input: SceneEmbeddingPayloadInput,
): Promise<WriteSceneEmbeddingPayloadResult> {
  if (!canWriteDerived(input.user)) {
    throw new SceneIndexError(
      "forbidden",
      "Indexing scene embeddings requires SYSTEM or ADMIN",
    )
  }

  if (input.scenes.length === 0) {
    return {
      editionId: input.editionId,
      locale: input.locale,
      scenesIndexed: 0,
      embeddingsWritten: 0,
      scenesPruned: 0,
      model: input.model,
      dimensions: input.dimensions,
    }
  }

  assertDimensions(input)
  assertNoDuplicateSceneIndexes(input.scenes)
  assertSceneContent(input)

  const prepared = input.scenes.map((scene) => ({
    scene,
    sourceText: scene.sourceText.trim(),
    description: scene.description.trim(),
  }))
  const incomingIndexes = prepared.map((p) => p.scene.sceneIndex)

  let embeddingsWritten = 0
  let scenesPruned = 0

  try {
    await prisma.$transaction(
      async (tx) => {
        const pruneResult = await tx.videoSceneLocale.deleteMany({
          where: {
            locale: input.locale,
            videoScene: {
              videoEditionId: input.editionId,
              sceneIndex: { notIn: incomingIndexes },
            },
          },
        })
        scenesPruned = pruneResult.count

        const parentIds = prepared.map(() => randomUUID())
        const sceneIndexes = prepared.map((p) => p.scene.sceneIndex)
        const parentVideoEditionIds = prepared.map(() => input.editionId)
        const parentVideoIds = prepared.map(() => input.videoId)
        const parentStartSeconds = prepared.map((p) =>
          String(p.scene.startSeconds),
        )
        const parentEndSeconds = prepared.map((p) =>
          p.scene.endSeconds == null ? null : String(p.scene.endSeconds),
        )
        const parentChapterTitles = prepared.map(
          (p) => p.scene.chapterTitle ?? null,
        )

        assertParallelArrayLengthsMatch(
          prepared.length,
          [
            { name: "parentIds", length: parentIds.length },
            { name: "sceneIndexes", length: sceneIndexes.length },
            {
              name: "parentVideoEditionIds",
              length: parentVideoEditionIds.length,
            },
            { name: "parentVideoIds", length: parentVideoIds.length },
            { name: "parentStartSeconds", length: parentStartSeconds.length },
            { name: "parentEndSeconds", length: parentEndSeconds.length },
            { name: "parentChapterTitles", length: parentChapterTitles.length },
          ],
          (msg) =>
            new SceneIndexError(
              "artifact_invalid",
              `internal: ${msg} (scene parent INSERT)`,
            ),
        )

        await tx.$executeRaw`
          INSERT INTO video_scene (
            id, video_edition_id, video_id, scene_index,
            start_seconds, end_seconds, chapter_title,
            created_at, updated_at
          )
          SELECT
            u.id,
            u.video_edition_id,
            u.video_id,
            u.scene_index::int,
            u.start_seconds::double precision,
            u.end_seconds::double precision,
            u.chapter_title,
            NOW(),
            NOW()
          FROM unnest(
            ${toPgArray(parentIds)}::text[],
            ${toPgArray(parentVideoEditionIds)}::text[],
            ${toPgArray(parentVideoIds)}::text[],
            ${toPgArray(sceneIndexes.map((n) => String(n)))}::text[],
            ${toPgArray(parentStartSeconds)}::text[],
            ${toPgArray(parentEndSeconds)}::text[],
            ${toPgArray(parentChapterTitles)}::text[]
          ) AS u(
            id, video_edition_id, video_id, scene_index,
            start_seconds, end_seconds, chapter_title
          )
          ON CONFLICT (video_edition_id, scene_index) DO NOTHING
        `

        const sceneIndexLiteral = toPgArray(sceneIndexes.map((n) => String(n)))
        const parentRows = await tx.$queryRaw<
          ReadonlyArray<{ id: string; scene_index: number }>
        >`
          SELECT id, scene_index
          FROM video_scene
          WHERE video_edition_id = ${input.editionId}
            AND scene_index = ANY(
              SELECT s::int FROM unnest(${sceneIndexLiteral}::text[]) AS s
            )
        `

        const sceneIndexToId = new Map<number, string>()
        for (const row of parentRows) {
          sceneIndexToId.set(row.scene_index, row.id)
        }

        const localeIds = prepared.map(() => randomUUID())
        const videoSceneIds = resolveVideoSceneIds(prepared, sceneIndexToId)
        const locales = prepared.map(() => input.locale)
        const sourceTexts = prepared.map((p) => p.sourceText)
        const descriptions = prepared.map((p) => p.description)
        const themesJson = prepared.map((p) =>
          JSON.stringify(p.scene.themes ?? []),
        )
        const bibleVersesJson = prepared.map((p) =>
          JSON.stringify(p.scene.bibleVerses ?? []),
        )
        const demographicsJson = prepared.map((p) =>
          JSON.stringify(p.scene.demographics ?? []),
        )
        const spiritualContextJson = prepared.map((p) =>
          JSON.stringify(p.scene.spiritualContext ?? []),
        )
        const models = prepared.map(() => input.model)
        const dimensions = prepared.map(() => String(input.dimensions))
        const embeddingProviders = prepared.map(
          () => input.provenance?.embeddingProvider ?? null,
        )
        const embeddingNativeDimensions = prepared.map(() =>
          input.provenance?.embeddingNativeDimensions == null
            ? null
            : String(input.provenance.embeddingNativeDimensions),
        )
        const embeddingTransformVersions = prepared.map(
          () => input.provenance?.embeddingTransformVersion ?? null,
        )
        const sourceArtifactKeys = prepared.map(
          () => input.provenance?.sourceArtifactKey ?? null,
        )
        const sourceArtifactVersions = prepared.map(
          () => input.provenance?.sourceArtifactVersion ?? null,
        )
        const sourceContentHashes = prepared.map(
          () => input.provenance?.sourceContentHash ?? null,
        )
        const sourceProviders = prepared.map(
          () => input.provenance?.sourceProvider ?? null,
        )
        const sourceGeneratedAts = prepared.map(
          () => input.provenance?.sourceGeneratedAt ?? null,
        )
        const generationModes = prepared.map(
          () => input.provenance?.generationMode ?? null,
        )
        const mastraRunIds = prepared.map(
          () => input.provenance?.mastraRunId ?? null,
        )
        const generatedAts = prepared.map(
          () => input.provenance?.generatedAt ?? null,
        )
        const vectorTexts = prepared.map((p) => toPgVector(p.scene.embedding))

        assertParallelArrayLengthsMatch(
          prepared.length,
          [
            { name: "localeIds", length: localeIds.length },
            { name: "videoSceneIds", length: videoSceneIds.length },
            { name: "locales", length: locales.length },
            { name: "sourceTexts", length: sourceTexts.length },
            { name: "descriptions", length: descriptions.length },
            { name: "themesJson", length: themesJson.length },
            { name: "bibleVersesJson", length: bibleVersesJson.length },
            { name: "demographicsJson", length: demographicsJson.length },
            {
              name: "spiritualContextJson",
              length: spiritualContextJson.length,
            },
            { name: "models", length: models.length },
            { name: "dimensions", length: dimensions.length },
            { name: "embeddingProviders", length: embeddingProviders.length },
            {
              name: "embeddingNativeDimensions",
              length: embeddingNativeDimensions.length,
            },
            {
              name: "embeddingTransformVersions",
              length: embeddingTransformVersions.length,
            },
            { name: "sourceArtifactKeys", length: sourceArtifactKeys.length },
            {
              name: "sourceArtifactVersions",
              length: sourceArtifactVersions.length,
            },
            { name: "sourceContentHashes", length: sourceContentHashes.length },
            { name: "sourceProviders", length: sourceProviders.length },
            { name: "sourceGeneratedAts", length: sourceGeneratedAts.length },
            { name: "generationModes", length: generationModes.length },
            { name: "mastraRunIds", length: mastraRunIds.length },
            { name: "generatedAts", length: generatedAts.length },
            { name: "vectorTexts", length: vectorTexts.length },
          ],
          (msg) =>
            new SceneIndexError(
              "artifact_invalid",
              `internal: ${msg} (scene locale INSERT)`,
            ),
        )

        const writeAffected = await tx.$executeRaw`
          INSERT INTO video_scene_locale (
            id, video_scene_id, locale, source_text, description,
            themes, bible_verses, demographics, spiritual_context,
            model, dimensions, embedding_provider, embedding_native_dimensions, embedding_transform_version,
            source_artifact_key, source_artifact_version, source_content_hash,
            source_provider, source_generated_at, generation_mode,
            mastra_run_id, generated_at, embedding,
            created_at, updated_at
          )
          SELECT
            u.id,
            u.video_scene_id,
            u.locale,
            u.source_text,
            u.description,
            ARRAY(SELECT jsonb_array_elements_text(u.themes_json::jsonb)),
            ARRAY(SELECT jsonb_array_elements_text(u.bible_verses_json::jsonb)),
            ARRAY(SELECT jsonb_array_elements_text(u.demographics_json::jsonb)),
            ARRAY(SELECT jsonb_array_elements_text(u.spiritual_context_json::jsonb)),
            u.model,
            u.dimensions::int,
            u.embedding_provider,
            u.embedding_native_dimensions::int,
            u.embedding_transform_version,
            u.source_artifact_key,
            u.source_artifact_version,
            u.source_content_hash,
            u.source_provider,
            u.source_generated_at::timestamp(3),
            u.generation_mode,
            u.mastra_run_id,
            u.generated_at::timestamp(3),
            u.embedding_text::vector(1536),
            NOW(),
            NOW()
          FROM unnest(
            ${toPgArray(localeIds)}::text[],
            ${toPgArray(videoSceneIds)}::text[],
            ${toPgArray(locales)}::text[],
            ${toPgArray(sourceTexts)}::text[],
            ${toPgArray(descriptions)}::text[],
            ${toPgArray(themesJson)}::text[],
            ${toPgArray(bibleVersesJson)}::text[],
            ${toPgArray(demographicsJson)}::text[],
            ${toPgArray(spiritualContextJson)}::text[],
            ${toPgArray(models)}::text[],
            ${toPgArray(dimensions)}::text[],
            ${toPgArray(embeddingProviders)}::text[],
            ${toPgArray(embeddingNativeDimensions)}::text[],
            ${toPgArray(embeddingTransformVersions)}::text[],
            ${toPgArray(sourceArtifactKeys)}::text[],
            ${toPgArray(sourceArtifactVersions)}::text[],
            ${toPgArray(sourceContentHashes)}::text[],
            ${toPgArray(sourceProviders)}::text[],
            ${toPgArray(sourceGeneratedAts)}::text[],
            ${toPgArray(generationModes)}::text[],
            ${toPgArray(mastraRunIds)}::text[],
            ${toPgArray(generatedAts)}::text[],
            ${toPgArray(vectorTexts)}::text[]
          ) AS u(
            id, video_scene_id, locale, source_text, description,
            themes_json, bible_verses_json, demographics_json, spiritual_context_json,
            model, dimensions, embedding_provider, embedding_native_dimensions, embedding_transform_version,
            source_artifact_key, source_artifact_version, source_content_hash,
            source_provider, source_generated_at, generation_mode,
            mastra_run_id, generated_at, embedding_text
          )
          ON CONFLICT (video_scene_id, locale)
          DO UPDATE SET
            source_text             = EXCLUDED.source_text,
            description             = EXCLUDED.description,
            themes                  = EXCLUDED.themes,
            bible_verses            = EXCLUDED.bible_verses,
            demographics            = EXCLUDED.demographics,
            spiritual_context       = EXCLUDED.spiritual_context,
            model                   = EXCLUDED.model,
            dimensions              = EXCLUDED.dimensions,
            embedding_provider      = EXCLUDED.embedding_provider,
            embedding_native_dimensions = EXCLUDED.embedding_native_dimensions,
            embedding_transform_version = EXCLUDED.embedding_transform_version,
            source_artifact_key     = EXCLUDED.source_artifact_key,
            source_artifact_version = EXCLUDED.source_artifact_version,
            source_content_hash     = EXCLUDED.source_content_hash,
            source_provider         = EXCLUDED.source_provider,
            source_generated_at     = EXCLUDED.source_generated_at,
            generation_mode         = EXCLUDED.generation_mode,
            mastra_run_id           = EXCLUDED.mastra_run_id,
            generated_at            = EXCLUDED.generated_at,
            embedding               = EXCLUDED.embedding,
            updated_at              = NOW()
        `
        embeddingsWritten = Number(writeAffected)
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    )
  } catch (error) {
    if (isPrismaRuntimeError(error)) {
      console.error(
        JSON.stringify({
          event: "scene_index_storage_error",
          editionId: input.editionId,
          locale: input.locale,
          name: (error as { name?: unknown }).name,
          code: (error as { code?: unknown }).code,
          messagePreview:
            error instanceof Error ? error.message.slice(0, 200) : undefined,
        }),
      )
      throw new SceneIndexError(
        "storage_failed",
        sanitizePrismaErrorMessage(error, "scene-embedding write"),
        error,
      )
    }
    throw error
  }

  return {
    editionId: input.editionId,
    locale: input.locale,
    scenesIndexed: prepared.length,
    embeddingsWritten,
    scenesPruned,
    model: input.model,
    dimensions: input.dimensions,
  }
}
