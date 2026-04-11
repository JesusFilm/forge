import type { Core } from "@strapi/strapi"

export type SceneEmbeddingInput = {
  videoId?: number
  coreId?: string
  muxAssetId: string
  playbackId: string
  sceneIndex: number
  startSeconds: number
  endSeconds?: number
  description: string
  themes?: string[]
  bibleVerses?: string[]
  demographics?: string[]
  spiritualContext?: string[]
  chapterTitle?: string
  embedding: number[]
  model?: string
  language?: string
}

export type SyncSceneEmbeddingsInput = {
  videoId?: number
  videoDocumentId?: string
  scenes: SceneEmbeddingInput[]
}

export type SceneEmbeddingIndexResult = {
  scenesIndexed: number
  resolvedVideoId?: number
  resolvedVideoIds?: number[]
  videoDocumentId?: string
}

type ResolvedSceneTarget = {
  resolvedVideoId: number
  videoDocumentId?: string
}

type ResolvedSceneEmbeddingInput = SceneEmbeddingInput & {
  videoId: number
}

type VideoRow = {
  id: number | string
  document_id?: string | null
  published_at?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

// 16 bindings per row -> 30 rows = 480 params (well within PG's 65535 limit)
const BATCH_SIZE = 30

export class SceneEmbeddingIndexError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message)
    this.name = "SceneEmbeddingIndexError"
  }
}

function toNumber(value: number | string | undefined | null): number {
  return typeof value === "number" ? value : Number(value ?? 0)
}

/** Convert a string array to a PostgreSQL array literal: {val1,val2} */
function toPgArray(arr: string[]): string {
  if (arr.length === 0) return "{}"
  return (
    "{" +
    arr
      .map((v) => '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')
      .join(",") +
    "}"
  )
}

async function readVideoRowsByDocumentId(
  strapi: Core.Strapi,
  videoDocumentId: string,
): Promise<VideoRow[]> {
  const knex: KnexInstance = strapi.db.connection
  const result: { rows: VideoRow[] } = await knex.raw(
    `
      SELECT id, document_id, published_at
      FROM videos
      WHERE document_id = ?
      ORDER BY CASE WHEN published_at IS NOT NULL THEN 0 ELSE 1 END, id DESC
    `,
    [videoDocumentId],
  )
  return result.rows ?? []
}

async function readVideoRowById(
  strapi: Core.Strapi,
  videoId: number,
): Promise<VideoRow | null> {
  const knex: KnexInstance = strapi.db.connection
  const result: { rows: VideoRow[] } = await knex.raw(
    `
      SELECT id, document_id, published_at
      FROM videos
      WHERE id = ?
      LIMIT 1
    `,
    [videoId],
  )
  return result.rows[0] ?? null
}

async function resolveSceneTarget(
  strapi: Core.Strapi,
  input: Pick<SyncSceneEmbeddingsInput, "videoId" | "videoDocumentId">,
): Promise<ResolvedSceneTarget> {
  if (typeof input.videoId === "number") {
    const row = await readVideoRowById(strapi, input.videoId)
    if (!row) {
      throw new SceneEmbeddingIndexError(404, "video_not_found")
    }

    if (row.published_at == null) {
      throw new SceneEmbeddingIndexError(409, "unpublished_video")
    }

    return {
      resolvedVideoId: toNumber(row.id),
      ...(row.document_id ? { videoDocumentId: row.document_id } : {}),
    }
  }

  if (
    typeof input.videoDocumentId === "string" &&
    input.videoDocumentId.trim().length > 0
  ) {
    const rows = await readVideoRowsByDocumentId(strapi, input.videoDocumentId)
    if (rows.length === 0) {
      throw new SceneEmbeddingIndexError(404, "video_not_found")
    }

    const publishedRow = rows.find((row) => row.published_at != null)
    if (!publishedRow) {
      throw new SceneEmbeddingIndexError(409, "unpublished_video")
    }

    return {
      resolvedVideoId: toNumber(publishedRow.id),
      videoDocumentId: publishedRow.document_id ?? input.videoDocumentId,
    }
  }

  throw new SceneEmbeddingIndexError(
    400,
    "invalid_video_target",
    "videoId or videoDocumentId is required",
  )
}

async function resolveScenesForWrite(
  strapi: Core.Strapi,
  input: SyncSceneEmbeddingsInput,
): Promise<{
  responseTarget?: ResolvedSceneTarget
  resolvedVideoIds: number[]
  scenes: ResolvedSceneEmbeddingInput[]
}> {
  const requestTargetProvided =
    typeof input.videoId === "number" ||
    (typeof input.videoDocumentId === "string" &&
      input.videoDocumentId.trim().length > 0)

  if (requestTargetProvided) {
    const target = await resolveSceneTarget(strapi, input)
    const conflictingRow = input.scenes.find(
      (scene) =>
        typeof scene.videoId === "number" &&
        scene.videoId !== target.resolvedVideoId,
    )

    if (conflictingRow) {
      throw new SceneEmbeddingIndexError(400, "conflicting_video_id")
    }

    return {
      responseTarget: target,
      resolvedVideoIds: [target.resolvedVideoId],
      scenes: input.scenes.map((scene) => ({
        ...scene,
        videoId: target.resolvedVideoId,
      })),
    }
  }

  const rowVideoIds = [
    ...new Set(
      input.scenes
        .map((scene) => scene.videoId)
        .filter((videoId): videoId is number => typeof videoId === "number"),
    ),
  ]

  if (rowVideoIds.length === 0) {
    throw new SceneEmbeddingIndexError(400, "invalid_video_target")
  }

  const targets = new Map<number, ResolvedSceneTarget>(
    await Promise.all(
      rowVideoIds.map(
        async (videoId): Promise<readonly [number, ResolvedSceneTarget]> => [
          videoId,
          await resolveSceneTarget(strapi, { videoId }),
        ],
      ),
    ),
  )

  const resolvedVideoIds = [
    ...new Set(
      rowVideoIds.map(
        (videoId) => targets.get(videoId)?.resolvedVideoId ?? videoId,
      ),
    ),
  ]

  return {
    ...(rowVideoIds.length === 1
      ? { responseTarget: targets.get(rowVideoIds[0]) }
      : {}),
    resolvedVideoIds,
    scenes: input.scenes.map((scene) => {
      if (typeof scene.videoId !== "number") {
        throw new SceneEmbeddingIndexError(400, "invalid_video_target")
      }

      const target = targets.get(scene.videoId)
      if (!target) {
        throw new SceneEmbeddingIndexError(400, "invalid_video_target")
      }

      return {
        ...scene,
        videoId: target.resolvedVideoId,
      }
    }),
  }
}

function assertNoDuplicateSceneIndexes(
  scenes: ResolvedSceneEmbeddingInput[],
): void {
  const seen = new Set<string>()

  for (const scene of scenes) {
    const key = `${scene.videoId}:${scene.sceneIndex}`
    if (seen.has(key)) {
      throw new SceneEmbeddingIndexError(400, "duplicate_scene_index")
    }
    seen.add(key)
  }
}

export async function indexSceneEmbeddings(
  strapi: Core.Strapi,
  input: SyncSceneEmbeddingsInput,
  options?: { skipDelete?: boolean },
): Promise<SceneEmbeddingIndexResult> {
  if (input.scenes.length === 0) {
    throw new SceneEmbeddingIndexError(400, "scenes_required")
  }

  const { responseTarget, resolvedVideoIds, scenes } =
    await resolveScenesForWrite(strapi, input)
  assertNoDuplicateSceneIndexes(scenes)

  const knex: KnexInstance = strapi.db.connection

  await knex.transaction(async (trx: KnexInstance) => {
    if (!options?.skipDelete) {
      if (resolvedVideoIds.length === 1) {
        await trx.raw("DELETE FROM scene_embeddings WHERE video_id = ?", [
          resolvedVideoIds[0],
        ])
      } else {
        await trx.raw(
          "DELETE FROM scene_embeddings WHERE video_id = ANY(?::int[])",
          [resolvedVideoIds],
        )
      }
    }

    for (let offset = 0; offset < scenes.length; offset += BATCH_SIZE) {
      const batch = scenes.slice(offset, offset + BATCH_SIZE)
      const placeholders: string[] = []
      const bindings: unknown[] = []

      for (const scene of batch) {
        placeholders.push(
          "(?, ?, ?, ?, ?, ?, ?, ?, ?::text[], ?::text[], ?::text[], ?::text[], ?, ?::vector, ?, ?)",
        )
        bindings.push(
          scene.videoId,
          scene.coreId ?? null,
          scene.muxAssetId,
          scene.playbackId,
          scene.sceneIndex,
          scene.startSeconds,
          scene.endSeconds ?? null,
          scene.description,
          toPgArray(scene.themes ?? []),
          toPgArray(scene.bibleVerses ?? []),
          toPgArray(scene.demographics ?? []),
          toPgArray(scene.spiritualContext ?? []),
          scene.chapterTitle ?? null,
          JSON.stringify(scene.embedding),
          scene.model ?? "text-embedding-3-small",
          scene.language ?? "en",
        )
      }

      await trx.raw(
        `INSERT INTO scene_embeddings
          (video_id, core_id, mux_asset_id, playback_id, scene_index,
           start_seconds, end_seconds, description, themes, bible_verses,
           demographics, spiritual_context, chapter_title, embedding, model, language)
         VALUES ${placeholders.join(", ")}`,
        bindings,
      )
    }
  })

  strapi.log.info(
    `[scene-embedding] Indexed ${scenes.length} scenes for ${
      resolvedVideoIds.length === 1
        ? `video ${resolvedVideoIds[0]}`
        : `${resolvedVideoIds.length} videos`
    }`,
  )

  return {
    scenesIndexed: scenes.length,
    ...(responseTarget
      ? {
          resolvedVideoId: responseTarget.resolvedVideoId,
          ...(responseTarget.videoDocumentId
            ? { videoDocumentId: responseTarget.videoDocumentId }
            : {}),
        }
      : {}),
    ...(resolvedVideoIds.length > 1 ? { resolvedVideoIds } : {}),
  }
}

export async function getProcessedVideoIds(
  strapi: Core.Strapi,
): Promise<number[]> {
  const knex: KnexInstance = strapi.db.connection
  const result: { rows: { video_id: number }[] } = await knex.raw(
    "SELECT DISTINCT video_id FROM scene_embeddings ORDER BY video_id",
  )
  return result.rows.map((r) => r.video_id)
}

export async function getSceneEmbeddingStats(
  strapi: Core.Strapi,
): Promise<{ totalVideos: number; totalScenes: number }> {
  const knex: KnexInstance = strapi.db.connection
  const result: {
    rows: { total_videos: string; total_scenes: string }[]
  } = await knex.raw(`
    SELECT
      COUNT(DISTINCT video_id)::text AS total_videos,
      COUNT(*)::text AS total_scenes
    FROM scene_embeddings
  `)
  const row = result.rows[0]
  return {
    totalVideos: Number(row?.total_videos ?? 0),
    totalScenes: Number(row?.total_scenes ?? 0),
  }
}
