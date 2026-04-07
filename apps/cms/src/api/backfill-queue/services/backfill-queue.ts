/**
 * Backfill Queue Service
 *
 * Returns the Phase 1 video queue for scene vectorization backfill.
 * One row per unique Video that has:
 *   - a subtitle in en, es, or fr with a VTT URL
 *   - a Mux video with duration > 0, asset_id, and playback_id
 *   - published, non-container label (excludes collection/series)
 *
 * Ordered: featureFilm first (early quality signal), then shortFilm, episode, segment.
 * Within a video, English subtitle is preferred over es/fr.
 */

import type { Core } from "@strapi/strapi"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type BackfillQueueRow = {
  videoId: number
  coreId: string | null
  title: string | null
  label: string | null
  muxAssetId: string
  playbackId: string
  subtitleUrl: string
  subtitleLanguage: string
}

export async function fetchBackfillQueue(
  strapi: Core.Strapi,
): Promise<BackfillQueueRow[]> {
  const knex: KnexInstance = strapi.db.connection

  // DISTINCT ON (v.id) picks one subtitle per video.
  // ORDER BY prefers English, then Spanish, then French.
  // Outer ORDER BY sorts by label priority for processing order.
  const result: { rows: Array<Record<string, unknown>> } = await knex.raw(`
    SELECT * FROM (
      SELECT DISTINCT ON (v.id, l.id)
        v.id           AS video_id,
        v.core_id,
        v.title,
        v.label,
        mv.asset_id   AS mux_asset_id,
        mv.playback_id,
        vs.vtt_src     AS subtitle_url,
        l.bcp_47        AS subtitle_language
      FROM videos v
      JOIN video_subtitles_video_lnk svl ON svl.video_id = v.id
      JOIN video_subtitles vs ON vs.id = svl.video_subtitle_id
        AND vs.published_at IS NOT NULL
        AND vs.vtt_src IS NOT NULL
        AND vs.vtt_src != ''
      JOIN video_subtitles_language_lnk sll ON sll.video_subtitle_id = vs.id
      JOIN languages l ON l.id = sll.language_id
        AND l.bcp_47 IN ('en', 'es', 'fr')
      JOIN video_variants_video_lnk vvl ON vvl.video_id = v.id
      JOIN video_variants vv ON vv.id = vvl.video_variant_id
        AND vv.published_at IS NOT NULL
        AND vv.duration > 0
      JOIN video_variants_language_lnk vll ON vll.video_variant_id = vv.id
        AND vll.language_id = l.id
      JOIN video_variants_mux_video_lnk vmvl ON vmvl.video_variant_id = vv.id
      JOIN mux_videos mv ON mv.id = vmvl.mux_video_id
        AND mv.published_at IS NOT NULL
        AND mv.asset_id IS NOT NULL
        AND mv.playback_id IS NOT NULL
      WHERE v.published_at IS NOT NULL
        AND v.label NOT IN ('collection', 'series')
      ORDER BY v.id, l.id
    ) sub
    ORDER BY
      CASE sub.label
        WHEN 'featureFilm' THEN 1
        WHEN 'shortFilm' THEN 2
        WHEN 'episode' THEN 3
        WHEN 'segment' THEN 4
        ELSE 5
      END,
      sub.video_id
  `)

  return result.rows.map((row) => ({
    videoId: Number(row.video_id),
    coreId: row.core_id as string | null,
    title: row.title as string | null,
    label: row.label as string | null,
    muxAssetId: row.mux_asset_id as string,
    playbackId: row.playback_id as string,
    subtitleUrl: row.subtitle_url as string,
    subtitleLanguage: row.subtitle_language as string,
  }))
}
