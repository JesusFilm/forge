import { Prisma, type PrismaClient } from "@prisma/client"
import { activeTranscriptContentEmbeddingWhere } from "@/services/content-embedding-contract"
import { PUBLIC_CONTENT_SLUG_SQL_PATTERN } from "@/services/search-watchability"
import type {
  CuratedHydratedVideo,
  CuratedPoolContext,
} from "./curated-pools.types"

type CatalogRow = {
  videoId: string
  videoCoreId: string
  videoSlug: string
  videoTitle: string | null
  description: string | null
  videoVisible: boolean
  imageUrl: string | null
  playbackId: string | null
  durationSeconds: number | null
  embeddingText: string | null
}

export async function hydrateCuratedVideos(
  prisma: Pick<PrismaClient, "$queryRaw">,
  videoIds: readonly string[],
  context: CuratedPoolContext,
): Promise<CuratedHydratedVideo[]> {
  if (videoIds.length === 0) return []
  const rows = await prisma.$queryRaw<CatalogRow[]>(Prisma.sql`
    SELECT video.id AS "videoId", video.core_id AS "videoCoreId",
      video.slug AS "videoSlug", display.title AS "videoTitle",
      LEFT(COALESCE(NULLIF(display.snippet, ''), display.description, ''), 1000) AS description,
      (video.deleted_at IS NULL AND NOT ('watch' = ANY(video.restrict_view_platforms))
        AND video.slug ~ ${PUBLIC_CONTENT_SLUG_SQL_PATTERN}) AS "videoVisible",
      image.url AS "imageUrl", dub.playback_id AS "playbackId",
      dub.duration_seconds AS "durationSeconds", identity.embedding AS "embeddingText"
    FROM video
    LEFT JOIN LATERAL (
      SELECT locale.title, locale.snippet, locale.description
      FROM video_locale locale
      WHERE locale.video_id = video.id AND locale.locale = ${context.locale}
        AND locale.status = 'published' AND locale.deleted_at IS NULL
        AND NULLIF(BTRIM(locale.title), '') IS NOT NULL
        AND LENGTH(locale.title) <= 512
      ORDER BY (locale.language_slug = ${context.audioLanguageSlug}) DESC NULLS LAST,
        locale.language_core_id ASC NULLS LAST, locale.id
      LIMIT 1
    ) display ON true
    LEFT JOIN LATERAL (
      SELECT mux.playback_id,
        COALESCE(ROUND(variant.length_in_milliseconds / 1000.0)::int, variant.duration) AS duration_seconds
      FROM video_dub variant
      JOIN language ON language.id = variant.language_id
        AND language.slug = ${context.audioLanguageSlug}
        AND language.core_id = ${context.coreLanguageId}
        AND language.deleted_at IS NULL
      JOIN mux_video mux ON mux.id = variant.mux_video_id
        AND mux.deleted_at IS NULL AND NULLIF(BTRIM(mux.playback_id), '') IS NOT NULL
        AND LENGTH(mux.playback_id) <= 512
      LEFT JOIN video_edition edition ON edition.id = variant.video_edition_id
      WHERE variant.video_id = video.id AND variant.deleted_at IS NULL
        AND variant.published = true
        AND (variant.video_edition_id IS NULL OR edition.deleted_at IS NULL)
      ORDER BY variant.updated_at DESC, variant.id
      LIMIT 1
    ) dub ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(BTRIM(art.mobile_cinematic_high), ''),
        NULLIF(BTRIM(art.video_still), ''), NULLIF(BTRIM(art.thumbnail), ''),
        NULLIF(BTRIM(art.url), '')) AS url
      FROM video_image art
      WHERE art.video_id = video.id AND art.deleted_at IS NULL
        AND COALESCE(NULLIF(BTRIM(art.mobile_cinematic_high), ''),
          NULLIF(BTRIM(art.video_still), ''), NULLIF(BTRIM(art.thumbnail), ''),
          NULLIF(BTRIM(art.url), '')) ~ '^https://'
      ORDER BY art.created_at, art.id
      LIMIT 1
    ) image ON true
    LEFT JOIN LATERAL (
      SELECT chunk.embedding::text AS embedding
      FROM video_transcript transcript
      JOIN video_transcript_chunk chunk ON chunk.transcript_id = transcript.id
      WHERE transcript.video_id = video.id AND transcript.language = ${context.locale}
        AND chunk.language = ${context.locale} AND chunk.embedding IS NOT NULL
        ${activeTranscriptContentEmbeddingWhere({ transcriptAlias: "transcript", chunkAlias: "chunk" })}
      ORDER BY chunk.chunk_index, transcript.generated_at DESC, chunk.id
      LIMIT 1
    ) identity ON true
    WHERE video.id IN (${Prisma.join(videoIds)})
  `)
  return rows.map((row) => {
    const rejectionReasons: string[] = []
    if (!row.videoVisible) rejectionReasons.push("watch_unavailable")
    if (!row.videoTitle) rejectionReasons.push("locale_unpublished")
    if (!row.playbackId) rejectionReasons.push("exact_audio_unavailable")
    let imageUrl = row.imageUrl
    try {
      if (
        !imageUrl ||
        imageUrl.length > 2048 ||
        new URL(imageUrl).protocol !== "https:"
      )
        imageUrl = null
    } catch {
      imageUrl = null
    }
    if (!imageUrl) rejectionReasons.push("artwork_unavailable")
    return {
      ...row,
      videoTitle: row.videoTitle ?? "",
      description: row.description ?? "",
      imageUrl,
      playbackId: row.playbackId ?? "",
      durationSeconds:
        row.durationSeconds == null || row.durationSeconds <= 0
          ? null
          : row.durationSeconds,
      rejectionReasons,
    }
  })
}
