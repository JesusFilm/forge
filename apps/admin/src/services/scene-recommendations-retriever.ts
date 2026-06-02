/**
 * SQL layer for R5 scene-recommendations.
 *
 * Port of cms's `apps/cms/src/api/scene-embedding/services/recommender.ts`
 * SQL, re-derived against admin's per-locale schema. Companion plan:
 * docs/plans/2026-04-23-003-feat-admin-r5-recommendations-plan.md Unit 2.
 *
 * Schema deltas from cms (see
 * docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md):
 *
 *   cms                                | admin
 *   -----------------------------------|-------------------------------
 *   scene_embeddings (single row)      | video_scene + video_scene_locale
 *   scene_embeddings.playback_id       | 3-hop VideoDub(edition, lang)
 *                                        → mux_video LATERAL lookup
 *   videos.title                       | video_locale.title
 *   video_variants publish chain       | video_locale.status='published'
 *                                        + video.deleted_at IS NULL
 *   videos_children_lnk                | video_relation
 *   video_images LATERAL               | dropped (imageUrl null; R4 parity)
 *   integer ids                        | cuid strings
 *
 * `playbackId` is kept NON-NULL via INNER JOIN on the dub+mux chain
 * (distinct from R4's hybrid-search which uses LEFT JOIN). Rationale:
 * cms's recommender guarantees `playbackId: String!` and apps/web's
 * renderer consumes it; a recommendation without a resolvable playback
 * is not actionable.
 */

import type { PrismaClient } from "@prisma/client"

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
 * A single input scene — its pgvector text form and the scene_index it
 * belongs to. One or many of these feed `queryScenesSimilar`.
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
 * Fetch input embeddings for the seed video. `sceneIndex` optional — when
 * provided, returns at most one row per edition (admin's unique is
 * `(videoEditionId, sceneIndex)`). When omitted, returns every scene
 * across every edition that has a localized description + embedding in
 * the requested locale.
 *
 * Rows with NULL embedding are filtered (the locale row may exist
 * without an embedding if the R1 backfill hasn't run yet).
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
        vsl.embedding::text AS embedding_text,
        vs.scene_index      AS scene_index
      FROM video_scene_locale vsl
      JOIN video_scene vs ON vs.id = vsl.video_scene_id
      WHERE vs.video_id = ${videoId}
        AND vs.scene_index = ${sceneIndex}
        AND vsl.locale = ${locale}
        AND vsl.embedding IS NOT NULL
      ORDER BY vs.scene_index
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
      vsl.embedding::text AS embedding_text,
      vs.scene_index      AS scene_index
    FROM video_scene_locale vsl
    JOIN video_scene vs ON vs.id = vsl.video_scene_id
    WHERE vs.video_id = ${videoId}
      AND vsl.locale = ${locale}
      AND vsl.embedding IS NOT NULL
    ORDER BY vs.scene_index
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
 * The similarity query: DISTINCT ON (video_id) over VideoSceneLocale.embedding,
 * locale-filtered, consumer-visibility gated, exclusion-filtered, with
 * the playbackId resolved via the 3-hop VideoDub(edition, lang) → MuxVideo
 * LATERAL. INNER JOIN on the dub/mux chain so rows without a resolvable
 * playback are filtered out (preserves cms's non-null `playbackId` contract).
 *
 * Matches R4's semantic-video retriever shape (subquery-then-ORDER-BY-
 * similarity) so the query planner hits the HNSW index then sorts the
 * small candidate set.
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
      SELECT DISTINCT ON (vs.video_id)
        vs.video_id                            AS video_id,
        v.slug                                 AS video_slug,
        vl.title                               AS video_title,
        v.core_id                              AS video_core_id,
        vs.scene_index                         AS scene_index,
        vsl.description                        AS description,
        vs.start_seconds                       AS start_seconds,
        vs.end_seconds                         AS end_seconds,
        vsl.themes                             AS themes,
        vsl.demographics                       AS demographics,
        vsl.spiritual_context                  AS spiritual_context,
        dub_mux.playback_id                    AS playback_id,
        1 - (vsl.embedding <=> ${queryEmbedding}::vector) AS similarity,
        vsl.embedding::text                    AS embedding_text
      FROM video_scene_locale vsl
      JOIN video_scene vs ON vs.id = vsl.video_scene_id
      JOIN video v ON v.id = vs.video_id
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
        WHERE vd.video_edition_id = vs.video_edition_id
          AND vd.deleted_at IS NULL
        ORDER BY vd.published DESC NULLS LAST, vd.updated_at DESC
        LIMIT 1
      ) dub_mux ON true
      WHERE vsl.embedding IS NOT NULL
        AND vsl.locale = ${locale}
        AND vs.video_id <> ALL(${excludeIds}::text[])
      ORDER BY vs.video_id, vsl.embedding <=> ${queryEmbedding}::vector
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
