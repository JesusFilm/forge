/**
 * Coverage Snapshot Service
 *
 * Computes library-wide enrichment coverage metrics and persists them
 * as a CoverageSnapshot record for historical trend tracking.
 *
 * Uses raw knex SQL for efficient aggregation across thousands of videos.
 *
 * Critical: All queries filter `published_at IS NOT NULL` to avoid counting
 * Strapi v5 draft rows (every published document has both a draft and published row).
 */

import type { Core } from "@strapi/strapi"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

type LanguageCoverageEntry = {
  languageCoreId: string
  languageName: string
  subtitlesHuman: number
  subtitlesAi: number
  audioHuman: number
  audioAi: number
}

type SnapshotData = {
  computedAt: string
  totalVideos: number
  videosWithAiMetadata: number
  videosWithHumanMetadata: number
  subtitlesHumanTotal: number
  subtitlesAiTotal: number
  audioHumanTotal: number
  audioAiTotal: number
  languageCoverage: LanguageCoverageEntry[]
}

type CoverageSnapshotDocument = {
  documentId: string
  date?: string
}

type CoverageSnapshotDocumentService = {
  findFirst: (
    params: Record<string, unknown>,
  ) => Promise<CoverageSnapshotDocument | null>
  update: (params: Record<string, unknown>) => Promise<CoverageSnapshotDocument>
  create: (params: Record<string, unknown>) => Promise<CoverageSnapshotDocument>
}

type MediaCoverageRow = {
  language_id: number
  language_core_id: string
  language_name: string
  has_human: boolean
  video_document_id: string
}

type MediaCoverageTotals = {
  human: number
  ai: number
}

type MediaCoverageResult = {
  byLanguage: Map<
    number,
    { coreId: string; name: string; human: number; ai: number }
  >
  totals: MediaCoverageTotals
}

/**
 * Query per-language coverage for a media type (subtitles or variants).
 *
 * For each (video, language) pair, determines whether the video has:
 * - "human": at least one non-AI item for that language
 * - "ai": ALL items for that language are AI-generated
 *
 * Returns a map of languageId → { human, ai, coreId, name }.
 */
async function queryMediaCoverage(
  knex: KnexInstance,
  config: {
    mediaTable: string
    mediaVideoLnk: string
    mediaFkColumn: string
    mediaLanguageLnk: string
  },
): Promise<MediaCoverageResult> {
  const { mediaTable, mediaVideoLnk, mediaFkColumn, mediaLanguageLnk } = config

  // For each (video, language) pair, determine if ANY item is non-AI.
  // BOOL_OR(NOT ai_generated) = true means at least one human item exists.
  const result: { rows: MediaCoverageRow[] } = await knex.raw(
    `
    SELECT
      l.id AS language_id,
      l.core_id AS language_core_id,
      l.name AS language_name,
      BOOL_OR(NOT COALESCE(m.ai_generated, false)) AS has_human,
      v.document_id AS video_document_id
    FROM ?? m
    JOIN ?? mvl ON mvl.?? = m.id
    JOIN ?? mll ON mll.?? = m.id
    JOIN videos v ON v.id = mvl.video_id AND v.published_at IS NOT NULL
    JOIN languages l ON l.id = mll.language_id AND l.published_at IS NOT NULL
    WHERE m.published_at IS NOT NULL
    GROUP BY l.id, l.core_id, l.name, v.document_id
    `,
    [mediaTable, mediaVideoLnk, mediaFkColumn, mediaLanguageLnk, mediaFkColumn],
  )

  // Aggregate: count distinct videos per language, split by human vs ai
  const langMap = new Map<
    number,
    { coreId: string; name: string; human: number; ai: number }
  >()
  const videoHasHuman = new Map<string, boolean>()

  for (const row of result.rows) {
    let entry = langMap.get(row.language_id)
    if (!entry) {
      entry = {
        coreId: row.language_core_id,
        name: row.language_name,
        human: 0,
        ai: 0,
      }
      langMap.set(row.language_id, entry)
    }
    if (row.has_human) {
      entry.human++
    } else {
      entry.ai++
    }

    videoHasHuman.set(
      row.video_document_id,
      (videoHasHuman.get(row.video_document_id) ?? false) || row.has_human,
    )
  }

  let human = 0
  let ai = 0
  for (const hasHuman of videoHasHuman.values()) {
    if (hasHuman) human++
    else ai++
  }

  return {
    byLanguage: langMap,
    totals: { human, ai },
  }
}

function coverageSnapshotDocs(
  strapi: Core.Strapi,
): CoverageSnapshotDocumentService {
  return strapi.documents(
    "api::coverage-snapshot.coverage-snapshot" as never,
  ) as unknown as CoverageSnapshotDocumentService
}

async function computeSnapshot(strapi: Core.Strapi): Promise<SnapshotData> {
  const knex = strapi.db.connection

  // Library-wide: total published videos (deduplicated across i18n locale rows)
  const [{ total_videos }]: Array<{ total_videos: string }> = await knex(
    "videos",
  )
    .whereNotNull("published_at")
    .countDistinct("document_id as total_videos")

  // Library-wide: videos with AI metadata
  const [{ ai_metadata_count }]: Array<{ ai_metadata_count: string }> =
    await knex("videos")
      .whereNotNull("published_at")
      .where("ai_metadata", true)
      .countDistinct("document_id as ai_metadata_count")

  const [{ human_metadata_count }]: Array<{ human_metadata_count: string }> =
    await knex("videos")
      .whereNotNull("published_at")
      .where("ai_metadata", false)
      .countDistinct("document_id as human_metadata_count")

  // Per-language subtitle coverage
  const subtitleCoverage = await queryMediaCoverage(knex, {
    mediaTable: "video_subtitles",
    mediaVideoLnk: "video_subtitles_video_lnk",
    mediaFkColumn: "video_subtitle_id",
    mediaLanguageLnk: "video_subtitles_language_lnk",
  })

  // Per-language audio variant coverage
  const audioCoverage = await queryMediaCoverage(knex, {
    mediaTable: "video_variants",
    mediaVideoLnk: "video_variants_video_lnk",
    mediaFkColumn: "video_variant_id",
    mediaLanguageLnk: "video_variants_language_lnk",
  })

  // Merge subtitle and audio coverage into a single per-language array
  const allLanguageIds = new Set([
    ...subtitleCoverage.byLanguage.keys(),
    ...audioCoverage.byLanguage.keys(),
  ])

  const languageCoverage: LanguageCoverageEntry[] = []
  for (const langId of allLanguageIds) {
    const sub = subtitleCoverage.byLanguage.get(langId)
    const audio = audioCoverage.byLanguage.get(langId)

    languageCoverage.push({
      languageCoreId: sub?.coreId ?? audio?.coreId ?? String(langId),
      languageName: sub?.name ?? audio?.name ?? "Unknown",
      subtitlesHuman: sub?.human ?? 0,
      subtitlesAi: sub?.ai ?? 0,
      audioHuman: audio?.human ?? 0,
      audioAi: audio?.ai ?? 0,
    })
  }

  // Sort by language name for consistent output
  languageCoverage.sort((a, b) => a.languageName.localeCompare(b.languageName))

  return {
    computedAt: new Date().toISOString(),
    totalVideos: Number(total_videos),
    videosWithAiMetadata: Number(ai_metadata_count),
    videosWithHumanMetadata: Number(human_metadata_count),
    subtitlesHumanTotal: subtitleCoverage.totals.human,
    subtitlesAiTotal: subtitleCoverage.totals.ai,
    audioHumanTotal: audioCoverage.totals.human,
    audioAiTotal: audioCoverage.totals.ai,
    languageCoverage,
  }
}

async function createSnapshot(strapi: Core.Strapi): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  strapi.log.info(`[coverage-snapshot] Computing coverage for ${todayStr}`)

  const snapshotData = await computeSnapshot(strapi)

  strapi.log.info(
    `[coverage-snapshot] ${snapshotData.totalVideos} videos, ` +
      `${snapshotData.videosWithAiMetadata} with AI metadata, ` +
      `${snapshotData.languageCoverage.length} languages with coverage`,
  )

  // Idempotent upsert: find existing snapshot for today, update or create
  const docs = coverageSnapshotDocs(strapi)
  const existing = await docs.findFirst({
    filters: { date: todayStr },
  })

  if (existing) {
    await docs.update({
      documentId: existing.documentId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: snapshotData as any,
    })
    strapi.log.info(
      `[coverage-snapshot] Updated existing snapshot for ${todayStr}`,
    )
  } else {
    await docs.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { date: todayStr, ...snapshotData } as any,
    })
    strapi.log.info(`[coverage-snapshot] Created new snapshot for ${todayStr}`)
  }
}

export default {
  createSnapshot: ({ strapi }: { strapi: Core.Strapi }) =>
    createSnapshot(strapi),
}
