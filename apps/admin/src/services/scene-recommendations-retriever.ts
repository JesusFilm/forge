/**
 * SQL layer for the legacy `sceneRecommendations` API.
 *
 * The API shape is still scene-flavoured for cms parity, but feat-192
 * stops consuming scene embeddings. Seed and candidate vectors now come
 * from enriched transcript chunks (`video_transcript_chunk`). The public
 * `sceneIndex` field is populated with `chunk_index` during this
 * transition so clients keep a stable integer anchor.
 *
 * `playbackId` is kept NON-NULL via INNER JOIN on the dub+mux chain.
 * Rationale: cms's recommender guarantees `playbackId: String!` and
 * apps/web's renderer consumes it; a recommendation without a resolvable
 * playback is not actionable.
 */

import type { PrismaClient } from "@prisma/client"

const QWEN_CONTENT_EMBEDDING_PROVIDER = "jesus-film-ai-gateway"
const QWEN_CONTENT_EMBEDDING_MODEL = "embeddings"
const QWEN_CONTENT_EMBEDDING_DIMENSIONS = 1536

/**
 * Raw shape returned by Postgres for the similarity query. `text[]`
 * columns can come back NULL via `$queryRaw` when the column is
 * nullable, so `themes` / `demographics` / `spiritual_context` are
 * nullable here. The mapper normalises them to `[]` before returning
 * the row as `SceneRecommendationSqlRow`.
 */
type SceneRecommendationSqlRowRaw = {
  video_id: string
  video_slug: string
  video_title: string | null
  video_core_id: string | null
  scene_index: number
  description: string
  /** Postgres numeric can arrive as string or number depending on driver. */
  start_seconds: number | string
  end_seconds: number | string | null
  themes: string[] | null
  demographics: string[] | null
  spiritual_context: string[] | null
  playback_id: string
  similarity: number | string
  embedding_text: string
}

/**
 * Normalised SQL row, service-internal — not exposed through any API
 * surface. `embedding_text` is carried so the 3-layer dedup can
 * recompute cosine similarity across survivors (cf. `video-dedup.ts`).
 *
 * Renamed from `SceneRecommendationRow` for clarity vs. the camelCase
 * public DTO `SceneRecommendation` in the service module.
 */
export type SceneRecommendationSqlRow = {
  video_id: string
  video_slug: string
  video_title: string | null
  video_core_id: string | null
  scene_index: number
  description: string
  start_seconds: number
  end_seconds: number | null
  themes: string[]
  demographics: string[]
  spiritual_context: string[]
  playback_id: string
  similarity: number
  embedding_text: string
}

/**
 * A single input transcript chunk — its pgvector text form and the
 * chunk_index it belongs to. One or many of these feed
 * `queryScenesSimilar`.
 */
export type InputSceneEmbedding = {
  embedding: string
  sceneIndex: number
}

/**
 * Resolve a `Video.slug` to its cuid id, respecting the soft-delete
 * filter. Returns null when no published, non-deleted video matches.
 */
export async function resolveSlugToVideoId(
  prisma: PrismaClient,
  slug: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM video
    WHERE slug = ${slug}
      AND deleted_at IS NULL
    LIMIT 1
  `
  return rows[0]?.id ?? null
}

/**
 * Fetch input embeddings for the seed video. `sceneIndex` optional — kept
 * for API compatibility and interpreted as transcript `chunk_index`.
 * When omitted, returns every transcript chunk across every edition that
 * has an embedding in the requested locale.
 *
 * Rows with NULL embedding are filtered. The provenance guard mirrors
 * hybrid semantic-video so recommendations use the same enriched
 * transcript vector space.
 */
export async function fetchInputEmbeddings(
  prisma: PrismaClient,
  videoId: string,
  locale: string,
  sceneIndex?: number,
): Promise<InputSceneEmbedding[]> {
  if (sceneIndex !== undefined) {
    const rows = await prisma.$queryRaw<
      { embedding_text: string; scene_index: number }[]
    >`
      SELECT
        vtc.embedding::text AS embedding_text,
        vtc.chunk_index     AS scene_index
      FROM video_transcript_chunk vtc
      JOIN video_transcript vt ON vt.id = vtc.transcript_id
      WHERE vt.video_id = ${videoId}
        AND vt.language = ${locale}
        AND vtc.language = ${locale}
        AND vtc.chunk_index = ${sceneIndex}
        AND vtc.embedding IS NOT NULL
        AND vt.embedding_provider = ${QWEN_CONTENT_EMBEDDING_PROVIDER}
        AND vt.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
        AND vt.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND vt.embedding_native_dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND vt.embedding_transform_version IS NULL
        AND vtc.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
        AND vtc.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
      ORDER BY vtc.chunk_index
    `
    return rows.map((r) => ({
      embedding: r.embedding_text,
      sceneIndex: r.scene_index,
    }))
  }

  const rows = await prisma.$queryRaw<
    { embedding_text: string; scene_index: number }[]
  >`
    SELECT
      vtc.embedding::text AS embedding_text,
      vtc.chunk_index     AS scene_index
    FROM video_transcript_chunk vtc
    JOIN video_transcript vt ON vt.id = vtc.transcript_id
    WHERE vt.video_id = ${videoId}
      AND vt.language = ${locale}
      AND vtc.language = ${locale}
      AND vtc.embedding IS NOT NULL
      AND vt.embedding_provider = ${QWEN_CONTENT_EMBEDDING_PROVIDER}
      AND vt.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
      AND vt.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
      AND vt.embedding_native_dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
      AND vt.embedding_transform_version IS NULL
      AND vtc.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
      AND vtc.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
    ORDER BY vtc.chunk_index
  `
  return rows.map((r) => ({
    embedding: r.embedding_text,
    sceneIndex: r.scene_index,
  }))
}

/**
 * Returns the set of video ids to exclude from recommendation results:
 * self + every parent + every child. Prevents recommending different
 * cuts of the same content (e.g. the JESUS film and its clip segments).
 */
export async function getRelatedVideoIds(
  prisma: PrismaClient,
  videoId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT ${videoId}::text AS id
    UNION
    SELECT parent_id AS id FROM video_relation WHERE child_id = ${videoId}
    UNION
    SELECT child_id  AS id FROM video_relation WHERE parent_id = ${videoId}
  `
  return rows.map((r) => r.id)
}

/**
 * The similarity query: DISTINCT ON (video_id) over transcript chunk
 * embeddings, locale-filtered, consumer-visibility gated,
 * exclusion-filtered, with playbackId resolved via the 3-hop
 * VideoDub(edition, lang) → MuxVideo LATERAL. INNER JOIN on the dub/mux
 * chain so rows without a resolvable playback are filtered out
 * (preserves cms's non-null `playbackId` contract).
 */
export async function queryScenesSimilar(
  prisma: PrismaClient,
  queryEmbedding: string,
  locale: string,
  excludeIds: string[],
  limit: number,
): Promise<SceneRecommendationSqlRow[]> {
  const rows = await prisma.$queryRaw<SceneRecommendationSqlRowRaw[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (vt.video_id)
        vt.video_id                            AS video_id,
        v.slug                                 AS video_slug,
        vl.title                               AS video_title,
        v.core_id                              AS video_core_id,
        vtc.chunk_index                        AS scene_index,
        COALESCE(
          NULLIF(vtc.content_summary, ''),
          NULLIF(vtc.raw_source_text, ''),
          vtc.text
        )                                      AS description,
        COALESCE(vtc.start_seconds, 0)         AS start_seconds,
        vtc.end_seconds                        AS end_seconds,
        vtc.felt_needs                         AS themes,
        vtc.demographics                       AS demographics,
        vtc.spiritual_context                  AS spiritual_context,
        dub_mux.playback_id                    AS playback_id,
        1 - (vtc.embedding <=> ${queryEmbedding}::vector) AS similarity,
        vtc.embedding::text                   AS embedding_text
      FROM video_transcript_chunk vtc
      JOIN video_transcript vt ON vt.id = vtc.transcript_id
        AND vt.language = ${locale}
      JOIN video v ON v.id = vt.video_id
        AND v.deleted_at IS NULL
      JOIN video_locale vl
        ON vl.video_id = v.id
        AND vl.locale  = ${locale}
        AND vl.status  = 'published'
        AND vl.deleted_at IS NULL
      JOIN LATERAL (
        SELECT mv.playback_id
        FROM video_dub vd
        JOIN language lg ON lg.id = vd.language_id
          AND lg.bcp47 = ${locale}
        JOIN mux_video mv ON mv.id = vd.mux_video_id
          AND mv.playback_id IS NOT NULL
        WHERE vd.video_edition_id = vt.video_edition_id
          AND vd.deleted_at IS NULL
        ORDER BY vd.published DESC NULLS LAST, vd.updated_at DESC
        LIMIT 1
      ) dub_mux ON true
      WHERE vtc.embedding IS NOT NULL
        AND vtc.language = ${locale}
        AND vt.video_id <> ALL(${excludeIds}::text[])
        AND vt.embedding_provider = ${QWEN_CONTENT_EMBEDDING_PROVIDER}
        AND vt.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
        AND vt.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND vt.embedding_native_dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND vt.embedding_transform_version IS NULL
        AND vtc.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
        AND vtc.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
      ORDER BY vt.video_id, vtc.embedding <=> ${queryEmbedding}::vector
    ) sub
    ORDER BY sub.similarity DESC
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    ...row,
    start_seconds: Number(row.start_seconds),
    end_seconds: row.end_seconds == null ? null : Number(row.end_seconds),
    similarity: Number(row.similarity),
    themes: row.themes ?? [],
    demographics: row.demographics ?? [],
    spiritual_context: row.spiritual_context ?? [],
  }))
}
