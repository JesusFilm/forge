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
//
// Stage 2 of the embed-backfill performance plan widens this service in
// two places:
//   1. The artifact can be supplied via `loadedArtifact` so the workflow
//      fetches once per (video, edition) group and passes it down to N
//      per-locale invocations — collapsing S3 reads from N×L to N.
//   2. Embeddings are generated in ONE batched provider call per
//      (video, locale) target rather than N per-scene calls. Length /
//      dimension mismatches now fail-fast for the whole target (typed
//      `EmbeddingsBatchError`) instead of partial-write — the trade-off
//      documented in the plan's §Key Technical Decisions and reflected
//      in `scenesSkipped` semantics (now effectively 0 on the happy
//      path; the field is preserved for backward compatibility).

import { type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { canWriteDerived } from "@/auth/permissions"
import { toPgVector } from "@/db/pgvector"
import {
  EXPERIENCE_EMBEDDING_DIMENSIONS,
  OPENROUTER_EMBEDDING_MODEL,
  generateExperienceEmbeddings,
} from "@/services/embeddings.service"
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
  /**
   * Pre-loaded scene-analysis artifact. When provided, the service
   * skips the S3 read. Stage 2 of the embed-backfill performance plan:
   * the workflow fetches once per (video, edition) group and passes
   * the same artifact into each per-locale invocation — collapsing S3
   * reads from N×L to N. Tests can also use this to inject a fixture
   * without touching S3.
   */
  loadedArtifact?: SceneAnalysisResult
  /** Override for tests — use this cmsVideoId instead of the mapping lookup. */
  cmsVideoIdOverride?: number
  /** Required when `loadedArtifact` is not set. */
  cmsVideoId?: number
}

export type IndexEditionScenesResult = {
  editionId: string
  locale: string
  scenesIndexed: number
  embeddingsWritten: number
  /**
   * Reserved for backwards-compatible callers. Stage 2 batches the
   * provider call so the prior per-scene "skip on individual provider
   * failure" semantic no longer applies — the whole `(video, locale)`
   * target succeeds or fails as a unit. Field stays for downstream
   * dashboards that read it; value is effectively 0 on the happy path.
   */
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
  if (input.loadedArtifact !== undefined) {
    artifact = input.loadedArtifact
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
    // An empty scene-analysis artifact is structurally a "success"
    // (no scenes to index) but operationally suspicious — manager's
    // pipeline should never write a zero-scene artifact for a real
    // video. Emit a structured warn so operators can grep this signal
    // out from genuine successes (manager bug, partial enrichment,
    // truncated upload, etc).
    console.warn(
      JSON.stringify({
        event: "scene_embed_empty_artifact",
        editionId: input.editionId,
        locale: input.locale,
        coreId: input.coreId,
        cmsVideoId: input.cmsVideoIdOverride ?? input.cmsVideoId ?? null,
      }),
    )
    return {
      editionId: input.editionId,
      locale: input.locale,
      scenesIndexed: 0,
      embeddingsWritten: 0,
      scenesSkipped: 0,
      scenesPruned: 0,
      model: OPENROUTER_EMBEDDING_MODEL,
      dimensions: EXPERIENCE_EMBEDDING_DIMENSIONS,
    }
  }

  assertNoDuplicateSceneIndexes(artifact.scenes)

  // Pre-validate descriptions synchronously BEFORE the provider call.
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

  // ONE batched provider call for the whole (video, locale) target.
  // Length-mismatch / dimension-mismatch surface as typed
  // `EmbeddingsBatchError` and propagate as `failed` outcomes from the
  // workflow's per-target catch — fail-fast for the whole target rather
  // than partial-write. See `EmbeddingsBatchError` typed `code` in
  // embeddings.service.ts.
  const sourceTexts = artifact.scenes.map((s) => s.description.trim())
  const generated = await generateExperienceEmbeddings(sourceTexts)

  // The batched API contract guarantees `embeddings[i]` corresponds to
  // `inputs[i]`. embeddings.service throws on length mismatch, so the
  // assertion below is true by construction; keep an explicit
  // construction-time check so a future change to the batched API can't
  // silently desync scene index ↔ vector index.
  if (generated.embeddings.length !== artifact.scenes.length) {
    throw new SceneIndexError(
      "artifact_invalid",
      `embedding response length ${generated.embeddings.length} does not match scene count ${artifact.scenes.length}`,
    )
  }

  const prepared = artifact.scenes.map((scene, i) => ({
    scene,
    sourceText: sourceTexts[i]!,
    embedding: generated.embeddings[i]!,
  }))

  const modelStamp = generated.model
  const dimensions = generated.dimensions
  const incomingIndexes = artifact.scenes.map((s) => s.sceneIndex)

  let embeddingsWritten = 0
  let scenesPruned = 0

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

      for (const { scene, sourceText, embedding } of prepared) {
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
            model: modelStamp,
            dimensions,
          },
          update: {
            sourceText,
            description: scene.description,
            themes: scene.themes,
            bibleVerses: scene.bibleVerses,
            demographics: scene.demographics,
            spiritualContext: scene.spiritualContext,
            model: modelStamp,
            dimensions,
          },
          select: { id: true },
        })

        await tx.$executeRaw`
          UPDATE video_scene_locale
          SET embedding = ${toPgVector(embedding)}::vector,
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
    scenesSkipped: 0,
    scenesPruned,
    model: modelStamp,
    dimensions,
  }
}
