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

import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { canWriteDerived } from "@/auth/permissions"
import { toPgVector } from "@/db/pgvector"
import { generateExperienceEmbedding } from "@/services/embeddings.service"
import {
  readSceneAnalysisArtifact,
  type SceneAnalysis,
  type SceneAnalysisResult,
} from "@/services/manager-artifacts.service"

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

  const cmsVideoId = input.cmsVideoIdOverride ?? input.cmsVideoId
  if (input.artifactOverride === undefined && cmsVideoId === undefined) {
    throw new SceneIndexError(
      "missing_cms_video_id",
      `cmsVideoId is required to fetch the scene-analysis artifact for coreId=${input.coreId}`,
    )
  }

  const artifact =
    input.artifactOverride ??
    (await readSceneAnalysisArtifact(String(cmsVideoId)))

  if (artifact.scenes.length === 0) {
    return {
      editionId: input.editionId,
      locale: input.locale,
      scenesIndexed: 0,
      embeddingsWritten: 0,
      model: "text-embedding-3-small",
      dimensions: 1536,
    }
  }

  assertNoDuplicateSceneIndexes(artifact.scenes)

  // Generate embeddings outside the transaction — the external provider
  // call can take seconds per batch and we don't want to hold a DB
  // transaction open during it. Each scene is independently re-embeddable,
  // so a partial provider failure just means fewer writes this run.
  const prepared = await Promise.all(
    artifact.scenes.map(async (scene) => {
      const sourceText = scene.description.trim()
      if (!sourceText) {
        throw new SceneIndexError(
          "empty_description",
          `scene ${scene.sceneIndex} has an empty description; cannot embed`,
        )
      }
      const generated = await generateExperienceEmbedding(sourceText)
      return { scene, sourceText, generated }
    }),
  )

  let embeddingsWritten = 0
  const modelStamp = prepared[0]!.generated.model
  const dimensions = prepared[0]!.generated.dimensions

  await prisma.$transaction(async (tx) => {
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

      await tx.$executeRaw(
        Prisma.sql`
          UPDATE video_scene_locale
          SET embedding = ${toPgVector(generated.embedding)}::vector,
              updated_at = NOW()
          WHERE id = ${videoSceneLocale.id}
        `,
      )
      embeddingsWritten += 1
    }
  })

  return {
    editionId: input.editionId,
    locale: input.locale,
    scenesIndexed: artifact.scenes.length,
    embeddingsWritten,
    model: modelStamp,
    dimensions,
  }
}
