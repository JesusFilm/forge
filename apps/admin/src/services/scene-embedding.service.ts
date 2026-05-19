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
//
// Stage 3 of the embed-backfill performance plan (feat-117) collapses
// the per-row write loop into TWO bulk SQL statements per `(video, edition)`
// target plus one bulk INSERT per `(video, edition, locale)`:
//   1. Bulk-insert parents via `INSERT INTO video_scene … SELECT * FROM
//      unnest(...) ON CONFLICT (video_edition_id, scene_index) DO NOTHING`
//      with client-side-generated ids, followed by ONE follow-up SELECT
//      that recovers the full `scene_index → id` map (for both new and
//      pre-existing parents — `DO NOTHING` doesn't return rows for
//      existing matches, and the rerun path needs ids for those too).
//   2. Bulk-upsert locale rows via `INSERT INTO video_scene_locale …
//      SELECT * FROM unnest(...) ON CONFLICT (video_scene_id, locale)
//      DO UPDATE`. Per-row Way A casts at the SELECT seam apply to both
//      the per-row `embedding` cast (`u.embedding_text::vector(1536)`)
//      and the per-row `text[]` columns (`themes`, `bible_verses`,
//      `demographics`, `spiritual_context`) which are bound as JSON-
//      stringified arrays and unfolded via `jsonb_array_elements_text`.
//      No `::vector(1536)[]` parameter cast — that array-input parser is
//      less-trodden code; Way A keeps the seam at one cast per row.
//   See docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md.

import { randomUUID } from "node:crypto"

import { type PrismaClient } from "@prisma/client"
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
  EmbeddingsBatchError,
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
 * Prisma's default interactive-transaction timeout is 5s. Stage 3 collapses
 * the per-scene round-trips into a small constant number of bulk statements
 * (parent INSERT + parent SELECT + locale INSERT + pre-prune deleteMany),
 * but the 30s ceiling is preserved for safety against one-off pgvector
 * planner regressions on large fixture sets.
 */
const TRANSACTION_TIMEOUT_MS = 30_000
const RETRY_BACKOFF_MS = [25, 100] as const

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
      | "empty_description"
      | "storage_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SceneIndexError"
  }
}

/**
 * Map each prepared scene to its parent `video_scene.id` via the
 * `scene_index → id` map produced by the post-INSERT recovery SELECT.
 * Throws `SceneIndexError("artifact_invalid", ...)` on the first miss —
 * a missing id implies either a concurrent delete, an RLS view, or a
 * planner bug, none of which are recoverable mid-transaction. Hoisted
 * out of the bulk-write builder pass so the invariant check is
 * separated from the array-build orchestration.
 */
function resolveVideoSceneIds(
  prepared: ReadonlyArray<{ scene: { sceneIndex: number } }>,
  sceneIndexToId: ReadonlyMap<number, string>,
): string[] {
  return prepared.map((p) => {
    const id = sceneIndexToId.get(p.scene.sceneIndex)
    if (id === undefined) {
      throw new SceneIndexError(
        "artifact_invalid",
        `parent video_scene id not found for scene_index=${p.scene.sceneIndex} after bulk INSERT — concurrency or RLS bug`,
      )
    }
    return id
  })
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function retryTransient<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const backoffMs = RETRY_BACKOFF_MS[attempt]
      if (backoffMs === undefined || !shouldRetry(error)) {
        throw error
      }
      await sleep(backoffMs)
    }
  }
}

function isRetryableEmbeddingError(error: unknown): boolean {
  if (!(error instanceof EmbeddingsBatchError)) return false
  if (
    error.code === "request_timed_out" ||
    error.code === "validation_failed"
  ) {
    return true
  }
  if (error.code !== "request_failed") return false
  return error.status == null || error.status === 429 || error.status >= 500
}

function isRetryablePrismaTransactionError(error: unknown): boolean {
  if (!isPrismaRuntimeError(error)) return false
  const code = (error as { code?: unknown }).code
  return code === "P1017" || code === "P2028"
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
  const generated = await retryTransient(
    () => generateExperienceEmbeddings(sourceTexts),
    isRetryableEmbeddingError,
  )

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

  try {
    await retryTransient(
      () =>
        prisma.$transaction(
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

            // ─── Stage 3 (feat-117) — Bulk parent INSERT ────────────────────
            // Generate ids client-side. `VideoScene.id` is `String @id @default(cuid())`
            // in schema.prisma; the DB column is plain `text` with no shape
            // constraint, so any unique string is valid. `randomUUID()` keeps
            // the dep tree lean (no `cuid` package) and produces a 36-char ID
            // distinguishable at a glance from cuid-shaped ids on existing rows.
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
                {
                  name: "parentStartSeconds",
                  length: parentStartSeconds.length,
                },
                { name: "parentEndSeconds", length: parentEndSeconds.length },
                {
                  name: "parentChapterTitles",
                  length: parentChapterTitles.length,
                },
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

            // ON CONFLICT DO NOTHING does not return rows for the pre-existing
            // matches, so RETURNING id alone would lose ids for any rerun
            // where some scenes existed already. Run ONE follow-up SELECT to
            // recover the full `scene_index → id` map for all incoming
            // sceneIndexes (both freshly-inserted and previously-existing).
            const sceneIndexLiteral = toPgArray(
              sceneIndexes.map((n) => String(n)),
            )
            // Recover ids for ALL incoming sceneIndexes (both freshly inserted
            // and previously existing). `ON CONFLICT DO NOTHING` doesn't return
            // the existing rows, so a `RETURNING id` alone would lose them on
            // reruns where some scenes already existed.
            //
            // The parameter is a `text[]` literal; the inner subquery casts each
            // element to int so the outer `= ANY(...)` matches the int column.
            // Avoids the PG18 chained-cast trap (`?::jsonb::text[]`-style) by
            // unnesting before the per-element cast.
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
            // `tx.$queryRaw<{ scene_index: number }>` declares the field as
            // `number`; Prisma's `Int` mapping returns plain numbers here.
            // Trust the typed declaration and avoid a defensive `Number(...)`
            // coercion that would imply a runtime distrust the type assertion
            // doesn't admit.
            const sceneIndexToId = new Map<number, string>()
            for (const row of parentRows) {
              sceneIndexToId.set(row.scene_index, row.id)
            }

            // ─── Stage 3 (feat-117) — Bulk locale INSERT … ON CONFLICT … DO UPDATE ─
            // Build parallel arrays. text[] columns (themes, bibleVerses,
            // demographics, spiritualContext) are bound as JSON-stringified
            // strings and unfolded inside the SELECT seam via
            // `jsonb_array_elements_text(u.<col>_json::jsonb)` — Way A
            // discipline keeps the cast at the seam, not on the parameter.
            const localeIds = prepared.map(() => randomUUID())
            const videoSceneIds = resolveVideoSceneIds(prepared, sceneIndexToId)
            const locales = prepared.map(() => input.locale)
            const sourceTextsArr = prepared.map((p) => p.sourceText)
            const descriptions = prepared.map((p) => p.scene.description)
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
            const models = prepared.map(() => modelStamp)
            const dimensionsArr = prepared.map(() => String(dimensions))
            const vectorTexts = prepared.map((p) => toPgVector(p.embedding))

            assertParallelArrayLengthsMatch(
              prepared.length,
              [
                { name: "localeIds", length: localeIds.length },
                { name: "videoSceneIds", length: videoSceneIds.length },
                { name: "locales", length: locales.length },
                { name: "sourceTextsArr", length: sourceTextsArr.length },
                { name: "descriptions", length: descriptions.length },
                { name: "themesJson", length: themesJson.length },
                { name: "bibleVersesJson", length: bibleVersesJson.length },
                { name: "demographicsJson", length: demographicsJson.length },
                {
                  name: "spiritualContextJson",
                  length: spiritualContextJson.length,
                },
                { name: "models", length: models.length },
                { name: "dimensionsArr", length: dimensionsArr.length },
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
          model, dimensions, embedding,
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
          u.embedding_text::vector(1536),
          NOW(),
          NOW()
        FROM unnest(
          ${toPgArray(localeIds)}::text[],
          ${toPgArray(videoSceneIds)}::text[],
          ${toPgArray(locales)}::text[],
          ${toPgArray(sourceTextsArr)}::text[],
          ${toPgArray(descriptions)}::text[],
          ${toPgArray(themesJson)}::text[],
          ${toPgArray(bibleVersesJson)}::text[],
          ${toPgArray(demographicsJson)}::text[],
          ${toPgArray(spiritualContextJson)}::text[],
          ${toPgArray(models)}::text[],
          ${toPgArray(dimensionsArr)}::text[],
          ${toPgArray(vectorTexts)}::text[]
        ) AS u(
          id, video_scene_id, locale, source_text, description,
          themes_json, bible_verses_json, demographics_json, spiritual_context_json,
          model, dimensions, embedding_text
        )
        ON CONFLICT (video_scene_id, locale)
        DO UPDATE SET
          source_text       = EXCLUDED.source_text,
          description       = EXCLUDED.description,
          themes            = EXCLUDED.themes,
          bible_verses      = EXCLUDED.bible_verses,
          demographics      = EXCLUDED.demographics,
          spiritual_context = EXCLUDED.spiritual_context,
          model             = EXCLUDED.model,
          dimensions        = EXCLUDED.dimensions,
          embedding         = EXCLUDED.embedding,
          updated_at        = NOW()
      `
            embeddingsWritten = Number(writeAffected)
          },
          { timeout: TRANSACTION_TIMEOUT_MS },
        ),
      isRetryablePrismaTransactionError,
    )
  } catch (error) {
    // Remap Prisma runtime errors so their raw `message` (which on
    // $executeRaw failures includes the bound vector literal as well as
    // every other text[] parameter) does NOT round-trip into the
    // workflow's `outcome.reason` and out the GraphQL mutation response.
    // Mirrors the transcript-embedding indexer's posture. Non-Prisma
    // errors propagate unchanged.
    if (isPrismaRuntimeError(error)) {
      console.error(
        JSON.stringify({
          event: "scene_index_storage_error",
          editionId: input.editionId,
          locale: input.locale,
          name: (error as { name?: unknown }).name,
          code: (error as { code?: unknown }).code,
          // Deliberately truncated: the first 200 chars of the raw
          // message are enough to identify the query shape without
          // leaking the full vector parameter or text[] payloads.
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
    scenesSkipped: 0,
    scenesPruned,
    model: modelStamp,
    dimensions,
  }
}
