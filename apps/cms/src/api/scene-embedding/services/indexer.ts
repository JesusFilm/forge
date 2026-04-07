import type { Core } from "@strapi/strapi"

export type SceneEmbeddingInput = {
  videoId: number
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
  chapterTitle?: string
  embedding: number[]
  model?: string
  language?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

// 15 bindings per row → 30 rows = 450 params (well within PG's 65535 limit)
const BATCH_SIZE = 30

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

export async function indexSceneEmbeddings(
  strapi: Core.Strapi,
  scenes: SceneEmbeddingInput[],
): Promise<{ scenesIndexed: number }> {
  if (scenes.length === 0) return { scenesIndexed: 0 }

  const knex: KnexInstance = strapi.db.connection

  const videoIds = [...new Set(scenes.map((s) => s.videoId))]

  await knex.transaction(async (trx: KnexInstance) => {
    // Batch delete all affected videos in one statement
    await trx.raw(
      "DELETE FROM scene_embeddings WHERE video_id = ANY(?::int[])",
      [videoIds],
    )

    // Batch insert
    for (let offset = 0; offset < scenes.length; offset += BATCH_SIZE) {
      const batch = scenes.slice(offset, offset + BATCH_SIZE)
      const placeholders: string[] = []
      const bindings: unknown[] = []

      for (const scene of batch) {
        placeholders.push(
          "(?, ?, ?, ?, ?, ?, ?, ?, ?::text[], ?::text[], ?::text[], ?, ?::vector, ?, ?)",
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
           demographics, chapter_title, embedding, model, language)
         VALUES ${placeholders.join(", ")}`,
        bindings,
      )
    }
  })

  strapi.log.info(
    `[scene-embedding] Indexed ${scenes.length} scenes for ${videoIds.length} video(s)`,
  )

  return { scenesIndexed: scenes.length }
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
