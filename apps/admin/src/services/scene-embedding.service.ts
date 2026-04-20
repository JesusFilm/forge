// Scene embedding indexer — reads manager's scene-analysis artifacts
// from S3, regenerates embeddings in admin's embedding provider, and
// persists VideoScene + VideoSceneLocale rows.
//
// Source data: apps/manager's {assetId}/scene-analysis.json artifacts.
// assetId is the integer cms videos.id as a string. Admin resolves
// Video.coreId → cmsVideoId via the mapping loaded by
// core-id-mapping.service.ts.
//
// ABAC: canWriteDerived gates entry. The backfill workflow runs as
// SYSTEM; ADMIN principals may also invoke for incident response.
//
// Indexing is idempotent. Re-running for the same (editionId, locale)
// upserts both VideoScene and VideoSceneLocale rows; existing
// embeddings are overwritten. The Prisma client-extension guard in
// `src/db/client.ts` strips `embedding` from default result sets across
// all models, so scene locales behave the same as experience locales.

import { type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { canWriteDerived } from "@/auth/permissions"
import { toPgVector } from "@/db/pgvector"
import { generateExperienceEmbedding } from "@/services/embeddings.service"
import {
  readSceneAnalysisArtifact,
  type SceneAnalysis,
  type SceneAnalysisResult,
} from "@/services/manager-artifacts.service"

/**
 * Prisma's default interactive-transaction timeout is 5s. A single
 * indexer call can write ~30 per-scene round-trips; 5s is too tight
 * for a feature-length video's scene count at Railway Postgres
 * latencies. 30s keeps the ceiling comfortable while still bounded.
 */
const TRANSACTION_TIMEOUT_MS = 30_000

export type IndexEditionScenesInput = {
  editionId: string
  videoId: string
  coreId: string
  locale: string
  user: Principal | null
  /** Override for tests — injects a pre-loaded artifact instead of S3 read. */
  artifactOverride?: SceneAnalysisResult
  /** Override for tests — use this cmsVideoId instead of the mapping lookup. */
  cmsVideoIdOverride?: number
  /** Required when artifactOverride is not set. */
  cmsVideoId?: number
}

export type IndexEditionScenesResult = {
  editionId: string
  locale: string
  scenesIndexed: number
  embeddingsWritten: number
  scenesSkipped: number
  scenesPruned: number
  model: string
  dimensions: number
}

export class SceneIndexError extends Error {
  constructor(
    readonly code:
      | "forbidden"
      | "missing_cms_video_id"
      | "artifact_missing"
      | "artifact_invalid"
      | "duplicate_scene_index"
      | "empty_description",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SceneIndexError"
  }
}

function assertNoDuplicateSceneIndexes(scenes: readonly SceneAnalysis[]): void {
  const seen = new Set<number>()
  for (const scene of scenes) {
    if (seen.has(scene.sceneIndex)) {
      throw new SceneIndexError(
        "duplicate_scene_index",
        `scene_index ${scene.sceneIndex} appears more than once in the artifact`,
      )
    }
    seen.add(scene.sceneIndex)
  }
}

/**
 * Re-index scenes for (editionId, locale) from manager's scene-analysis
 * artifact. Writes VideoScene + VideoSceneLocale rows and populates the
 * embedding vector for each locale row.
 */
export async function indexEditionScenes(
  prisma: PrismaClient,
  input: IndexEditionScenesInput,
): Promise<IndexEditionScenesResult> {
  if (!canWriteDerived(input.user)) {
    throw new SceneIndexError(
      "forbidden",
      "Indexing scene embeddings requires SYSTEM or ADMIN",
    )
  }

  let artifact: SceneAnalysisResult
  if (input.artifactOverride !== undefined) {
    artifact = input.artifactOverride
  } else {
    const cmsVideoId = input.cmsVideoIdOverride ?? input.cmsVideoId
    if (cmsVideoId === undefined) {
      throw new SceneIndexError(
        "missing_cms_video_id",
        `cmsVideoId is required to fetch the scene-analysis artifact for coreId=${input.coreId}`,
      )
    }
    artifact = await readSceneAnalysisArtifact(String(cmsVideoId))
  }

  if (artifact.scenes.length === 0) {
    return {
      editionId: input.editionId,
      locale: input.locale,
      scenesIndexed: 0,
      embeddingsWritten: 0,
      scenesSkipped: 0,
      scenesPruned: 0,
      model: "text-embedding-3-small",
      dimensions: 1536,
    }
  }

  assertNoDuplicateSceneIndexes(artifact.scenes)

  // Pre-validate descriptions synchronously BEFORE any provider calls.
  // Keeps the duplicate/empty-check errors coherent (same input, same
  // complaint) and avoids paying for embeddings on an artifact we'll
  // reject anyway.
  for (const scene of artifact.scenes) {
    if (!scene.description.trim()) {
      throw new SceneIndexError(
        "empty_description",
        `scene ${scene.sceneIndex} has an empty description; cannot embed`,
      )
    }
  }

  // Generate embeddings outside the transaction with allSettled so one
  // provider failure doesn't abort the whole target — partial success is
  // the intended semantic. Scenes whose embedding failed are skipped
  // with a structured log; the remaining scenes land in the DB.
  const embeddingResults = await Promise.allSettled(
    artifact.scenes.map(async (scene) => {
      const sourceText = scene.description.trim()
      const generated = await generateExperienceEmbedding(sourceText)
      return { scene, sourceText, generated }
    }),
  )

  const prepared: Array<{
    scene: SceneAnalysis
    sourceText: string
    generated: Awaited<ReturnType<typeof generateExperienceEmbedding>>
  }> = []
  let scenesSkipped = 0
  for (let i = 0; i < embeddingResults.length; i += 1) {
    const result = embeddingResults[i]!
    if (result.status === "fulfilled") {
      prepared.push(result.value)
    } else {
      scenesSkipped += 1
      const scene = artifact.scenes[i]!
      console.error(
        JSON.stringify({
          event: "scene_embed_failed",
          editionId: input.editionId,
          locale: input.locale,
          sceneIndex: scene.sceneIndex,
          reason:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        }),
      )
    }
  }

  if (prepared.length === 0) {
    return {
      editionId: input.editionId,
      locale: input.locale,
      scenesIndexed: 0,
      embeddingsWritten: 0,
      scenesSkipped,
      scenesPruned: 0,
      model: "text-embedding-3-small",
      dimensions: 1536,
    }
  }

  let embeddingsWritten = 0
  let scenesPruned = 0
  const [firstPrepared] = prepared
  const modelStamp = firstPrepared!.generated.model
  const dimensions = firstPrepared!.generated.dimensions
  const incomingIndexes = artifact.scenes.map((s) => s.sceneIndex)

  await prisma.$transaction(
    async (tx) => {
      // Prune locale rows whose scene_index is no longer in the artifact —
      // covers the case where manager re-analyzes and produces fewer
      // scenes. Bounded to the current (editionId, locale) so other
      // locales' rows are untouched. Runs before upserts so the
      // idempotent-rerun path stays the same.
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

      for (const { scene, sourceText, generated } of prepared) {
        // Upsert the language-agnostic scene. First-locale-wins on
        // chapterTitle / timecodes if multiple locales drift.
        const videoScene = await tx.videoScene.upsert({
          where: {
            videoEditionId_sceneIndex: {
              videoEditionId: input.editionId,
              sceneIndex: scene.sceneIndex,
            },
          },
          create: {
            videoEditionId: input.editionId,
            videoId: input.videoId,
            sceneIndex: scene.sceneIndex,
            startSeconds: scene.startSeconds,
            endSeconds: scene.endSeconds ?? null,
            chapterTitle: scene.chapterTitle ?? null,
          },
          // Do not overwrite fields that should stay stable across re-indexes.
          update: {},
          select: { id: true },
        })

        const videoSceneLocale = await tx.videoSceneLocale.upsert({
          where: {
            videoSceneId_locale: {
              videoSceneId: videoScene.id,
              locale: input.locale,
            },
          },
          create: {
            videoSceneId: videoScene.id,
            locale: input.locale,
            sourceText,
            description: scene.description,
            themes: scene.themes,
            bibleVerses: scene.bibleVerses,
            demographics: scene.demographics,
            spiritualContext: scene.spiritualContext,
            model: generated.model,
            dimensions: generated.dimensions,
          },
          update: {
            sourceText,
            description: scene.description,
            themes: scene.themes,
            bibleVerses: scene.bibleVerses,
            demographics: scene.demographics,
            spiritualContext: scene.spiritualContext,
            model: generated.model,
            dimensions: generated.dimensions,
          },
          select: { id: true },
        })

        await tx.$executeRaw`
          UPDATE video_scene_locale
          SET embedding = ${toPgVector(generated.embedding)}::vector,
              updated_at = NOW()
          WHERE id = ${videoSceneLocale.id}
        `
        embeddingsWritten += 1
      }
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  )

  return {
    editionId: input.editionId,
    locale: input.locale,
    scenesIndexed: prepared.length,
    embeddingsWritten,
    scenesSkipped,
    scenesPruned,
    model: modelStamp,
    dimensions,
  }
}
