/**
 * Video Coverage Service
 *
 * Computes per-video coverage counts via SQL aggregation. Returns all
 * published videos with metadata, parent-child links, image URLs, and
 * subtitle/audio coverage counts broken down by human vs AI.
 *
 * Follows the same SQL pattern as coverage-snapshot service but returns
 * per-video detail instead of library-wide aggregates.
 *
 * Critical: All queries filter `published_at IS NOT NULL` to avoid
 * counting Strapi v5 draft rows.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

type CoverageCounts = {
  human: number
  ai: number
}

type VideoCoverageRow = {
  document_id: string
  core_id: string | null
  title: string | null
  label: string | null
  slug: string | null
  ai_metadata: boolean | null
  thumbnail: string | null
  video_still: string | null
  parent_document_ids: string[] | null
  sub_human: number
  sub_ai: number
  aud_human: number
  aud_ai: number
}

type VideoCoverageResult = {
  documentId: string
  coreId: string | null
  title: string | null
  label: string | null
  slug: string | null
  aiMetadata: boolean | null
  thumbnailUrl: string | null
  videoStillUrl: string | null
  parentDocumentIds: string[]
  coverage: {
    subtitles: CoverageCounts
    audio: CoverageCounts
  }
}

export async function queryVideoCoverage(
  knex: KnexInstance,
  languageIds?: string[],
): Promise<VideoCoverageResult[]> {
  const hasLangFilter = languageIds && languageIds.length > 0

  // Two-step approach: first compute per-video, per-language coverage in CTEs,
  // then aggregate to per-video counts and join with video metadata.

  const bindings: unknown[] = []

  // Subtitle coverage CTE
  const subLangClause = hasLangFilter ? `AND l.core_id = ANY(?)` : ""
  if (hasLangFilter) bindings.push(languageIds)

  // Variant coverage CTE
  const audLangClause = hasLangFilter ? `AND l.core_id = ANY(?)` : ""
  if (hasLangFilter) bindings.push(languageIds)

  const sql = `
    WITH subtitle_per_lang AS (
      SELECT
        v.document_id AS vid,
        l.core_id AS lang_core_id,
        BOOL_OR(NOT COALESCE(s.ai_generated, true)) AS has_human
      FROM video_subtitles s
      JOIN video_subtitles_video_lnk svl ON svl.video_subtitle_id = s.id
      JOIN video_subtitles_language_lnk sll ON sll.video_subtitle_id = s.id
      JOIN videos v ON v.id = svl.video_id AND v.published_at IS NOT NULL
      JOIN languages l ON l.id = sll.language_id ${subLangClause}
      WHERE s.published_at IS NOT NULL
      GROUP BY v.document_id, l.core_id
    ),
    subtitle_cov AS (
      SELECT
        vid,
        COUNT(*) FILTER (WHERE has_human) AS sub_human,
        COUNT(*) FILTER (WHERE NOT has_human) AS sub_ai
      FROM subtitle_per_lang
      GROUP BY vid
    ),
    variant_per_lang AS (
      SELECT
        v.document_id AS vid,
        l.core_id AS lang_core_id,
        BOOL_OR(NOT COALESCE(vr.ai_generated, true)) AS has_human
      FROM video_variants vr
      JOIN video_variants_video_lnk vvl ON vvl.video_variant_id = vr.id
      JOIN video_variants_language_lnk vll ON vll.video_variant_id = vr.id
      JOIN videos v ON v.id = vvl.video_id AND v.published_at IS NOT NULL
      JOIN languages l ON l.id = vll.language_id ${audLangClause}
      WHERE vr.published_at IS NOT NULL
      GROUP BY v.document_id, l.core_id
    ),
    variant_cov AS (
      SELECT
        vid,
        COUNT(*) FILTER (WHERE has_human) AS aud_human,
        COUNT(*) FILTER (WHERE NOT has_human) AS aud_ai
      FROM variant_per_lang
      GROUP BY vid
    ),
    parent_links AS (
      SELECT
        child.document_id AS child_doc_id,
        ARRAY_AGG(DISTINCT parent.document_id) AS parent_document_ids
      FROM videos_children_lnk cl
      JOIN videos parent ON parent.id = cl.video_id AND parent.published_at IS NOT NULL
      JOIN videos child ON child.id = cl.inv_video_id AND child.published_at IS NOT NULL
      GROUP BY child.document_id
    ),
    video_image AS (
      SELECT DISTINCT ON (v.document_id)
        v.document_id AS vid,
        vi.thumbnail,
        vi.video_still
      FROM videos v
      JOIN video_images_video_lnk vil ON vil.video_id = v.id
      JOIN video_images vi ON vi.id = vil.video_image_id AND vi.published_at IS NOT NULL
      WHERE v.published_at IS NOT NULL
      ORDER BY v.document_id, vi.id
    )
    SELECT
      v.document_id,
      v.core_id,
      v.title,
      v.label,
      v.slug,
      v.ai_metadata,
      img.thumbnail,
      img.video_still,
      pl.parent_document_ids,
      COALESCE(sc.sub_human, 0)::int AS sub_human,
      COALESCE(sc.sub_ai, 0)::int AS sub_ai,
      COALESCE(vc.aud_human, 0)::int AS aud_human,
      COALESCE(vc.aud_ai, 0)::int AS aud_ai
    FROM videos v
    LEFT JOIN subtitle_cov sc ON sc.vid = v.document_id
    LEFT JOIN variant_cov vc ON vc.vid = v.document_id
    LEFT JOIN parent_links pl ON pl.child_doc_id = v.document_id
    LEFT JOIN video_image img ON img.vid = v.document_id
    WHERE v.published_at IS NOT NULL
    ORDER BY v.title NULLS LAST
  `

  const result: { rows: VideoCoverageRow[] } = await knex.raw(sql, bindings)

  return result.rows.map((row) => ({
    documentId: row.document_id,
    coreId: row.core_id,
    title: row.title,
    label: row.label,
    slug: row.slug,
    aiMetadata: row.ai_metadata,
    thumbnailUrl: row.thumbnail,
    videoStillUrl: row.video_still,
    parentDocumentIds: row.parent_document_ids ?? [],
    coverage: {
      subtitles: { human: row.sub_human, ai: row.sub_ai },
      audio: { human: row.aud_human, ai: row.aud_ai },
    },
  }))
}
