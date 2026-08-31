import type { PrismaClient } from "@prisma/client"
import type { SceneRecommendation } from "@/services/scene-recommendations.service"
import { VideoNotFoundError } from "@/services/scene-recommendations.service"
import { dedupeByVideoIdentity } from "@/services/video-dedup"
import type { SemanticCandidatePoolItem } from "./candidate"

const QWEN_CONTENT_EMBEDDING_PROVIDER = "jesus-film-ai-gateway"
const QWEN_CONTENT_EMBEDDING_MODEL = "embeddings"
const QWEN_CONTENT_EMBEDDING_DIMENSIONS = 1536

// Delivery has a hard 1.5-second retrieval budget. Sampling evenly across a
// long transcript bounds the number of ANN probes without reverting to the
// legacy service's one-round-trip-per-chunk loop.
// Eight evenly distributed probes retain coverage across long-form seeds while
// keeping the ANN fan-out comfortably inside the cold-path contract under
// ordinary application load. Forty-eight neighbors per probe leaves a 64x
// overfetch margin for a six-item slate before eligibility, deduplication, and
// the bounded recent-item suppression window. Keeping the reserve in this one
// query avoids a second vector round trip on the delivery hot path.
const DELIVERY_SEED_SAMPLE_LIMIT = 8
const DELIVERY_NEIGHBORS_PER_SEED = 48
const DELIVERY_OVERFETCH_FACTOR = 6

type DeliveryRecommendationRow = {
  seed_count: number | bigint
  video_id: string | null
  video_slug: string | null
  video_title: string | null
  video_core_id: string | null
  scene_index: number | null
  description: string | null
  start_seconds: number | string | null
  end_seconds: number | string | null
  duration_seconds: number | string | null
  themes: string[] | null
  demographics: string[] | null
  spiritual_context: string[] | null
  playback_id: string | null
  image_url: string | null
  similarity: number | string | null
  embedding_text: string | null
}

/**
 * Delivery-only semantic retrieval.
 *
 * Unlike the compatibility `SceneRecommendationsService`, this executes one
 * set-based statement for a multi-chunk seed. The query keeps all mutable
 * eligibility checks inside the deadline-scoped transaction, ranks one best
 * transcript chunk per target video, and returns an overfetched ordered pool
 * for the existing three-layer video deduplicator.
 */
export async function getSemanticDeliveryCandidatePool(
  prisma: Pick<PrismaClient, "$queryRaw">,
  input: {
    seedMediaId: string
    locale: string
    audioLanguageSlug: string
    limit: number
  },
): Promise<SemanticCandidatePoolItem[]> {
  const overfetchLimit = Math.max(
    input.limit,
    input.limit * DELIVERY_OVERFETCH_FACTOR,
  )
  const rows = await prisma.$queryRaw<DeliveryRecommendationRow[]>`
    WITH seed_candidates AS MATERIALIZED (
      SELECT
        vtc.id,
        vtc.chunk_index,
        vtc.embedding
      FROM video_transcript_chunk vtc
      JOIN video_transcript vt ON vt.id = vtc.transcript_id
      WHERE vt.video_id = ${input.seedMediaId}
        AND vt.language = ${input.locale}
        AND vtc.language = ${input.locale}
        AND vtc.embedding IS NOT NULL
        AND vt.embedding_provider = ${QWEN_CONTENT_EMBEDDING_PROVIDER}
        AND vt.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
        AND vt.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND vt.embedding_native_dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND vt.embedding_transform_version IS NULL
        AND vtc.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
        AND vtc.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
    ),
    bucketed_seed_chunks AS MATERIALIZED (
      SELECT
        id,
        chunk_index,
        embedding,
        ntile(${DELIVERY_SEED_SAMPLE_LIMIT}::int) OVER (
          ORDER BY chunk_index, id
        ) AS seed_bucket
      FROM seed_candidates
    ),
    seed_chunks AS MATERIALIZED (
      SELECT DISTINCT ON (seed_bucket)
        embedding AS seed_embedding
      FROM bucketed_seed_chunks
      ORDER BY seed_bucket, chunk_index, id
    ),
    excluded_video_ids AS MATERIALIZED (
      SELECT ${input.seedMediaId}::text AS id
      UNION
      SELECT parent_id FROM video_relation WHERE child_id = ${input.seedMediaId}
      UNION
      SELECT child_id FROM video_relation WHERE parent_id = ${input.seedMediaId}
    ),
    excluded_transcript_ids AS MATERIALIZED (
      SELECT vt.id
      FROM video_transcript vt
      JOIN excluded_video_ids excluded ON excluded.id = vt.video_id
    ),
    nearest_chunks AS MATERIALIZED (
      SELECT nearest.*
      FROM seed_chunks seed
      CROSS JOIN LATERAL (
        SELECT
          candidate.id,
          candidate.transcript_id,
          candidate.chunk_index,
          candidate.content_summary,
          candidate.raw_source_text,
          candidate.text,
          candidate.start_seconds,
          candidate.end_seconds,
          candidate.felt_needs,
          candidate.demographics,
          candidate.spiritual_context,
          candidate.embedding,
          1 - (
            candidate.embedding OPERATOR(public.<=>) seed.seed_embedding
          ) AS similarity
        FROM video_transcript_chunk candidate
        WHERE candidate.embedding IS NOT NULL
          AND candidate.language = ${input.locale}
          AND candidate.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
          AND candidate.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
          AND NOT EXISTS (
            SELECT 1
            FROM excluded_transcript_ids excluded
            WHERE excluded.id = candidate.transcript_id
          )
        ORDER BY
          candidate.embedding OPERATOR(public.<=>) seed.seed_embedding
        LIMIT ${DELIVERY_NEIGHBORS_PER_SEED}
      ) nearest
    ),
    eligible_chunks AS MATERIALIZED (
      SELECT
        vt.video_id,
        v.slug AS video_slug,
        display_locale.title AS video_title,
        v.core_id AS video_core_id,
        nearest.id AS chunk_id,
        nearest.chunk_index AS scene_index,
        COALESCE(
          NULLIF(nearest.content_summary, ''),
          NULLIF(nearest.raw_source_text, ''),
          nearest.text
        ) AS description,
        COALESCE(nearest.start_seconds, 0) AS start_seconds,
        nearest.end_seconds,
        dub_mux.duration_seconds,
        nearest.felt_needs AS themes,
        nearest.demographics,
        nearest.spiritual_context,
        dub_mux.playback_id,
        nearest.similarity,
        nearest.embedding
      FROM nearest_chunks nearest
      JOIN video_transcript vt
        ON vt.id = nearest.transcript_id
        AND vt.language = ${input.locale}
        AND vt.embedding_provider = ${QWEN_CONTENT_EMBEDDING_PROVIDER}
        AND vt.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
        AND vt.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND vt.embedding_native_dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND vt.embedding_transform_version IS NULL
      JOIN video v
        ON v.id = vt.video_id
        AND v.deleted_at IS NULL
        AND NOT ('watch' = ANY(v.restrict_view_platforms))
      JOIN LATERAL (
        SELECT vl_display.title
        FROM video_locale vl_display
        WHERE vl_display.video_id = v.id
          AND vl_display.locale = ${input.locale}
          AND vl_display.status = 'published'
          AND vl_display.deleted_at IS NULL
        ORDER BY
          CASE
            WHEN vl_display.language_slug = ${input.audioLanguageSlug} THEN 0
            ELSE 1
          END,
          vl_display.language_core_id ASC NULLS LAST,
          vl_display.language_slug ASC NULLS LAST,
          vl_display.id ASC
        LIMIT 1
      ) display_locale ON true
      JOIN LATERAL (
        SELECT
          mv.playback_id,
          COALESCE(
            ROUND(vd.length_in_milliseconds / 1000.0)::int,
            vd.duration
          ) AS duration_seconds
        FROM video_dub vd
        JOIN language lg
          ON lg.id = vd.language_id
          AND lg.slug = ${input.audioLanguageSlug}
        JOIN mux_video mv
          ON mv.id = vd.mux_video_id
          AND mv.playback_id IS NOT NULL
        WHERE vd.video_edition_id = vt.video_edition_id
          AND vd.deleted_at IS NULL
        ORDER BY vd.published DESC NULLS LAST, vd.updated_at DESC, vd.id ASC
        LIMIT 1
      ) dub_mux ON true
      WHERE EXISTS (
        SELECT 1
        FROM video_locale vl_visible
        WHERE vl_visible.video_id = v.id
          AND vl_visible.locale = ${input.locale}
          AND vl_visible.status = 'published'
          AND vl_visible.deleted_at IS NULL
      )
    ),
    ranked_chunks AS MATERIALIZED (
      SELECT
        eligible_chunks.*,
        row_number() OVER (
          PARTITION BY video_id
          ORDER BY similarity DESC, scene_index, chunk_id
        ) AS video_rank
      FROM eligible_chunks
    ),
    ordered_candidates AS MATERIALIZED (
      SELECT *
      FROM ranked_chunks
      WHERE video_rank = 1
      ORDER BY similarity DESC, video_id, scene_index
      LIMIT ${overfetchLimit}
    )
    SELECT
      (SELECT count(*)::int FROM seed_candidates) AS seed_count,
      video_id,
      video_slug,
      video_title,
      video_core_id,
      scene_index,
      description,
      start_seconds,
      end_seconds,
      duration_seconds,
      themes,
      demographics,
      spiritual_context,
      playback_id,
      selected_image.image_url,
      similarity,
      embedding::text AS embedding_text
    FROM ordered_candidates
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        NULLIF(image.mobile_cinematic_high, ''),
        NULLIF(image.video_still, ''),
        NULLIF(image.thumbnail, ''),
        NULLIF(image.url, '')
      ) AS image_url
      FROM video_image image
      WHERE image.video_id = ordered_candidates.video_id
        AND image.deleted_at IS NULL
        AND COALESCE(
          NULLIF(image.mobile_cinematic_high, ''),
          NULLIF(image.video_still, ''),
          NULLIF(image.thumbnail, ''),
          NULLIF(image.url, '')
        ) IS NOT NULL
      ORDER BY
        CASE
          WHEN NULLIF(image.mobile_cinematic_high, '') IS NOT NULL THEN 0
          WHEN NULLIF(image.video_still, '') IS NOT NULL THEN 1
          WHEN NULLIF(image.thumbnail, '') IS NOT NULL THEN 2
          ELSE 3
        END,
        image.created_at,
        image.id
      LIMIT 1
    ) selected_image ON true
    UNION ALL
    SELECT
      (SELECT count(*)::int FROM seed_candidates) AS seed_count,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL
    WHERE NOT EXISTS (SELECT 1 FROM ordered_candidates)
    ORDER BY similarity DESC NULLS LAST, video_id, scene_index
  `

  if (Number(rows[0]?.seed_count ?? 0) === 0) {
    throw new VideoNotFoundError(input.seedMediaId)
  }

  const candidates = rows.flatMap((row) => {
    if (
      row.video_id == null ||
      row.video_slug == null ||
      row.scene_index == null ||
      row.description == null ||
      row.start_seconds == null ||
      row.playback_id == null ||
      row.similarity == null ||
      row.embedding_text == null
    ) {
      return []
    }
    return [
      {
        row,
        videoCoreId: row.video_core_id,
        videoTitle: row.video_title,
        embeddingText: row.embedding_text,
      },
    ]
  })

  return candidates.map(({ row, videoCoreId, embeddingText }) => ({
    videoId: row.video_id!,
    videoSlug: row.video_slug!,
    videoTitle: row.video_title ?? "",
    imageUrl:
      row.image_url?.trim() ||
      buildSemanticCandidateMuxThumbnailUrl(
        row.playback_id!,
        Number(row.start_seconds),
      ),
    sceneIndex: row.scene_index!,
    description: row.description!,
    startSeconds: Number(row.start_seconds),
    endSeconds: row.end_seconds == null ? null : Number(row.end_seconds),
    durationSeconds:
      row.duration_seconds == null ? null : Number(row.duration_seconds),
    similarity: Number(row.similarity),
    themes: row.themes ?? [],
    demographics: row.demographics ?? [],
    spiritualContext: row.spiritual_context ?? [],
    playbackId: row.playback_id!,
    videoCoreId,
    embeddingText,
    locale: input.locale,
    audioLanguageSlug: input.audioLanguageSlug,
    watchPlayable: true,
    localePublished: true,
  }))
}

export function buildSemanticCandidateMuxThumbnailUrl(
  playbackId: string,
  startSeconds: number,
): string {
  const boundedTime = Number.isFinite(startSeconds)
    ? Math.max(0, Math.min(86_400, startSeconds))
    : 0
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?time=${boundedTime}`
}

/**
 * Compatibility wrapper for callers that still expect the original bounded
 * semantic DTO. Live delivery consumes the raw bounded pool above so the
 * permanent union stage owns canonical-video deduplication and its evidence.
 */
export async function getSemanticDeliveryRecommendations(
  prisma: Pick<PrismaClient, "$queryRaw">,
  input: {
    seedMediaId: string
    locale: string
    audioLanguageSlug: string
    limit: number
  },
): Promise<SceneRecommendation[]> {
  const candidates = await getSemanticDeliveryCandidatePool(prisma, input)
  return dedupeByVideoIdentity(candidates, input.limit).map(
    ({
      videoCoreId: _videoCoreId,
      embeddingText: _embeddingText,
      locale: _locale,
      audioLanguageSlug: _audioLanguageSlug,
      watchPlayable: _watchPlayable,
      localePublished: _localePublished,
      sourceRejectionReason: _sourceRejectionReason,
      ...recommendation
    }) => recommendation,
  )
}
