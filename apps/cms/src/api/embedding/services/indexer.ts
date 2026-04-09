import type { Core } from "@strapi/strapi"

type ChunkInput = {
  text: string
  embedding: number[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

// 5 bindings per row → 50 rows = 250 params (well within PG's 65535 limit)
const BATCH_SIZE = 50

export async function indexVideoEmbeddings(
  strapi: Core.Strapi,
  videoId: number,
  chunks: ChunkInput[],
  model = "text-embedding-3-small",
): Promise<{ chunksIndexed: number }> {
  const knex: KnexInstance = strapi.db.connection

  await knex.transaction(async (trx: KnexInstance) => {
    await trx.raw("DELETE FROM video_embeddings WHERE video_id = ?", [videoId])

    for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + BATCH_SIZE)
      const placeholders: string[] = []
      const bindings: unknown[] = []

      for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i]!
        placeholders.push("(?, ?, ?, ?::vector, ?)")
        bindings.push(
          videoId,
          offset + i,
          chunk.text,
          JSON.stringify(chunk.embedding),
          model,
        )
      }

      await trx.raw(
        `INSERT INTO video_embeddings (video_id, chunk_index, chunk_text, embedding, model)
         VALUES ${placeholders.join(", ")}`,
        bindings,
      )
    }
  })

  strapi.log.info(
    `[embedding] Indexed ${chunks.length} chunks for video ${videoId}`,
  )

  return { chunksIndexed: chunks.length }
}

export async function getVideoEmbeddingStats(
  strapi: Core.Strapi,
): Promise<{ totalVideos: number; totalChunks: number }> {
  const knex: KnexInstance = strapi.db.connection
  const result: {
    rows: { total_videos: string; total_chunks: string }[]
  } = await knex.raw(`
    SELECT
      COUNT(DISTINCT video_id)::text AS total_videos,
      COUNT(*)::text AS total_chunks
    FROM video_embeddings
  `)
  const row = result.rows[0]
  return {
    totalVideos: Number(row?.total_videos ?? 0),
    totalChunks: Number(row?.total_chunks ?? 0),
  }
}
