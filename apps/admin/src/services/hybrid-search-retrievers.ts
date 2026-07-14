/**
 * Four retrievers that feed the hybrid-search RRF orchestrator.
 *
 * Port of apps/cms/src/api/search/services/{semantic,keyword,
 * experience-semantic,experience-keyword}-search.ts, re-derived against
 * admin's per-locale schema. See
 * docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md Unit 3.
 *
 * Shape invariants:
 * - All rows carry `resultType` + `resultId` so they flow straight into
 *   the fusion layer without a separate annotate step.
 * - `resultId` is a cuid string for both corpora (admin-native). For
 *   experience rows it's the `ExperienceLocale.id` (see inline comment
 *   on searchExperienceSemantic for why).
 * - Video retrievers resolve `imageUrl` via LATERAL on `VideoImage`,
 *   matching cms's `keyword-search.ts` / `semantic-search.ts` lookup
 *   over `video_images_video_lnk → video_images.mobile_cinematic_high`.
 *   Experience retrievers still return `imageUrl: null` (cms parity —
 *   cms's experience retrievers also defer the og_image join); wiring
 *   `ExperienceLocale.ogImageUrl` is a post-R8 follow-up.
 * - Semantic-video exposes `embedding_text` so the 3-layer dedup can
 *   recompute cosine similarity across survivors. This field is a
 *   service-internal transport only; the schema.test.ts
 *   /embed|vector|similarit/i guard covers the GraphQL surface.
 */

import { Prisma, type PrismaClient } from "@prisma/client"
import {
  VIDEO_LOCALE_TSVECTOR_QUERY_EXPR,
  EXPERIENCE_LOCALE_TSVECTOR_QUERY_EXPR,
} from "./hybrid-search-sql"
import type { RankedItem } from "./hybrid-search-fusion"
import {
  recordSearchDbTiming,
  type SearchTimingRecorder,
} from "./hybrid-search-timing"

const QWEN_CONTENT_EMBEDDING_PROVIDER = "jesus-film-ai-gateway"
const QWEN_CONTENT_EMBEDDING_MODEL = "embeddings"
const QWEN_CONTENT_EMBEDDING_DIMENSIONS = 1536

// -----------------------------------------------------------------------------
// Shared parameter shapes
// -----------------------------------------------------------------------------

export type SemanticSearchParams = {
  /** pgvector text format, e.g. "[0.1,0.2,...]" — pre-formatted by the
   *  orchestrator (see hybrid-search.service.ts) so the shape is consistent
   *  across both semantic retrievers. */
  queryEmbedding: string
  locale: string
  limit: number
}

export const VIDEO_SEMANTIC_MAX_AGREEMENT_BONUS = 0.01
export const VIDEO_SEMANTIC_AGREEMENT_THRESHOLD = 0.75
export const VIDEO_SEMANTIC_AGREEMENT_FACTOR = 0.04

export function calculateVideoSemanticMixedScore(
  sourceScores: readonly number[],
): number {
  if (sourceScores.length === 0) return 0
  const bestSourceScore = Math.max(...sourceScores)
  if (sourceScores.length < 2) return bestSourceScore

  const weakestSourceScore = Math.min(...sourceScores)
  const agreementBonus = Math.min(
    VIDEO_SEMANTIC_MAX_AGREEMENT_BONUS,
    Math.max(0, weakestSourceScore - VIDEO_SEMANTIC_AGREEMENT_THRESHOLD) *
      VIDEO_SEMANTIC_AGREEMENT_FACTOR,
  )

  return Math.min(1, bestSourceScore + agreementBonus)
}

export type KeywordSearchParams = {
  query: string
  locale: string
  limit: number
}

// -----------------------------------------------------------------------------
// Return shapes
// -----------------------------------------------------------------------------

export type VideoSemanticResult = RankedItem & {
  resultType: "video"
  resultId: string
  videoCoreId: string | null
  videoSlug: string
  videoTitle: string
  imageUrl: string | null
  sceneDescription: string
  startSeconds: number | null
  playbackId: string | null
  similarity: number
  embeddingText: string
}

export type VideoKeywordResult = RankedItem & {
  resultType: "video"
  resultId: string
  videoCoreId: string | null
  videoSlug: string
  videoTitle: string
  imageUrl: string | null
  description: string | null
  // Mux playback_id for any in-locale dub on this video, or null when no
  // dub-with-mux exists. Surfaces here so consumer cards can build a Mux
  // thumbnail URL when the match is keyword-only — without this the
  // semantic-only retriever was the sole source, and on a fresh DB
  // (no scene embeddings) every result came back without a thumbnail.
  // Mirrors `VideoSemanticResult.playbackId`; same chain
  // (video → dub → language → mux_video) but keyed on video_id directly
  // since the keyword retriever has no scene/edition context.
  playbackId: string | null
  rank: number
}

export type ExperienceSemanticResult = RankedItem & {
  resultType: "experience"
  resultId: string
  experienceSlug: string
  experienceTitle: string
  experienceMetaDescription: string | null
  imageUrl: null
  similarity: number
}

export type ExperienceKeywordResult = RankedItem & {
  resultType: "experience"
  resultId: string
  experienceSlug: string
  experienceTitle: string
  experienceMetaDescription: string | null
  imageUrl: null
  rank: number
}

// -----------------------------------------------------------------------------
// Internal raw-row shapes (as Postgres returns them)
// -----------------------------------------------------------------------------

type VideoSemanticRow = {
  video_id: string
  video_core_id: string | null
  video_slug: string | null
  video_title: string | null
  image_url: string | null
  scene_description: string
  start_seconds: number | null
  playback_id: string | null
  similarity: number
  embedding_text: string
}

type VideoSemanticEvidenceRow = VideoSemanticRow & {
  evidence_id: string
  evidence_source: "scene" | "transcript"
  source_score: number
}

function evidenceSourcePriority(source: "scene" | "transcript"): number {
  return source === "scene" ? 0 : 1
}

function compareNullableStartSeconds(
  a: number | null,
  b: number | null,
): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

export function mixVideoSemanticEvidenceRows(
  rows: readonly VideoSemanticEvidenceRow[],
): VideoSemanticRow[] {
  const byVideo = new Map<string, VideoSemanticEvidenceRow[]>()
  for (const row of rows) {
    const existing = byVideo.get(row.video_id)
    if (existing == null) {
      byVideo.set(row.video_id, [row])
    } else {
      existing.push(row)
    }
  }

  const mixed: Array<
    VideoSemanticRow & {
      best_source_score: number
      winner_source_priority: number
    }
  > = []
  for (const evidenceRows of byVideo.values()) {
    evidenceRows.sort((a, b) => {
      const scoreDelta = Number(b.source_score) - Number(a.source_score)
      if (scoreDelta !== 0) return scoreDelta

      const sourceDelta =
        evidenceSourcePriority(a.evidence_source) -
        evidenceSourcePriority(b.evidence_source)
      if (sourceDelta !== 0) return sourceDelta

      const timeDelta = compareNullableStartSeconds(
        a.start_seconds,
        b.start_seconds,
      )
      if (timeDelta !== 0) return timeDelta

      return a.evidence_id.localeCompare(b.evidence_id)
    })

    const winner = evidenceRows[0]!
    const sourceScores = evidenceRows.map((row) => Number(row.source_score))
    const bestSourceScore = Math.max(...sourceScores)
    mixed.push({
      video_id: winner.video_id,
      video_core_id: winner.video_core_id,
      video_slug: winner.video_slug,
      video_title: winner.video_title,
      image_url: winner.image_url,
      scene_description: winner.scene_description,
      start_seconds: winner.start_seconds,
      playback_id: winner.playback_id,
      similarity: calculateVideoSemanticMixedScore(sourceScores),
      embedding_text: winner.embedding_text,
      best_source_score: bestSourceScore,
      winner_source_priority: evidenceSourcePriority(winner.evidence_source),
    })
  }

  mixed.sort((a, b) => {
    const mixedScoreDelta = Number(b.similarity) - Number(a.similarity)
    if (mixedScoreDelta !== 0) return mixedScoreDelta

    const sourceScoreDelta =
      Number(b.best_source_score) - Number(a.best_source_score)
    if (sourceScoreDelta !== 0) return sourceScoreDelta

    const sourceDelta = a.winner_source_priority - b.winner_source_priority
    if (sourceDelta !== 0) return sourceDelta

    const timeDelta = compareNullableStartSeconds(
      a.start_seconds,
      b.start_seconds,
    )
    if (timeDelta !== 0) return timeDelta

    return a.video_id.localeCompare(b.video_id)
  })

  return mixed.map(
    ({
      best_source_score: _bestSourceScore,
      winner_source_priority: _winnerSourcePriority,
      ...row
    }) => row,
  )
}

function videoTranscriptProvenanceFilter() {
  return Prisma.sql`
          AND vt.embedding_provider = ${QWEN_CONTENT_EMBEDDING_PROVIDER}
          AND vt.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
          AND vt.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
          AND vt.embedding_native_dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
          AND vt.embedding_transform_version IS NULL
          AND vtc.model = ${QWEN_CONTENT_EMBEDDING_MODEL}
          AND vtc.dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        `
}

function mapVideoSemanticEvidenceRows(
  evidenceRows: readonly VideoSemanticEvidenceRow[],
  limit: number,
): VideoSemanticResult[] {
  return mixVideoSemanticEvidenceRows(evidenceRows)
    .slice(0, limit)
    .map((row) => ({
      resultType: "video" as const,
      resultId: row.video_id,
      videoCoreId: row.video_core_id,
      videoSlug: row.video_slug ?? "",
      videoTitle: row.video_title ?? "",
      imageUrl: row.image_url ?? null,
      sceneDescription: row.scene_description,
      startSeconds:
        row.start_seconds == null ? null : Number(row.start_seconds),
      playbackId: row.playback_id,
      similarity: Number(row.similarity),
      embeddingText: row.embedding_text,
    }))
}

type VideoKeywordRow = {
  video_id: string
  video_core_id: string | null
  video_slug: string | null
  video_title: string | null
  image_url: string | null
  description: string | null
  playback_id: string | null
  rank: number
}

type ExperienceSemanticRow = {
  experience_locale_id: string
  slug: string | null
  title: string | null
  meta_description: string | null
  similarity: number
}

type ExperienceKeywordRow = {
  experience_locale_id: string
  slug: string | null
  title: string | null
  meta_description: string | null
  rank: number
}

// -----------------------------------------------------------------------------
// Retrievers
// -----------------------------------------------------------------------------

/**
 * Per-locale semantic search over video scene + transcript embeddings.
 *
 * One row per video carrying the best mixed evidence for the requested
 * locale. Scene and transcript candidates are collapsed inside this
 * retriever so RRF still sees a single `semantic-video` list.
 * `playbackId` resolves via a LATERAL
 * lookup on `video_dub` → `mux_video`, keyed by
 * `(video_edition_id, language.bcp47 = locale)`. When no dub matches
 * `(edition, locale)`, `playbackId` is NULL and the row still returns —
 * consumers render those like keyword-only matches (no deep-link).
 *
 * Consumer visibility gate: `video.deleted_at IS NULL` +
 * `video_locale.status = 'published'` for the requested locale. We do
 * NOT require `VideoDub.published = true` on the dub lookup — some
 * languages legitimately have no published dub yet, and the result
 * should still surface (playbackId null).
 */
export async function searchVideoSemantic(
  prisma: PrismaClient,
  params: SemanticSearchParams,
  timing?: SearchTimingRecorder,
): Promise<VideoSemanticResult[]> {
  const { queryEmbedding, locale, limit } = params
  const candidateLimit = Math.max(limit * 2, limit)

  const transcriptProvenanceFilter = videoTranscriptProvenanceFilter()

  const evidenceRows = await recordSearchDbTiming(
    timing,
    "semantic-video.query",
    () => prisma.$queryRaw<VideoSemanticEvidenceRow[]>`
      WITH query_embedding AS MATERIALIZED (
        SELECT ${queryEmbedding}::vector AS embedding
      ),
      best_transcript_per_video AS (
        SELECT DISTINCT ON (vt.video_id)
          vt.video_id                       AS video_id,
          vt.video_edition_id               AS video_edition_id,
          vtc.id                            AS evidence_id,
          'transcript'                      AS evidence_source,
          COALESCE(
            NULLIF(vtc.content_summary, ''),
            NULLIF(vtc.raw_source_text, ''),
            vtc.text
          )                                 AS scene_description,
          vtc.start_seconds                 AS start_seconds,
          1 - (vtc.embedding <=> qe.embedding) AS source_score
        FROM video_transcript_chunk vtc
        CROSS JOIN query_embedding qe
        JOIN video_transcript vt ON vt.id = vtc.transcript_id
          AND vt.language = ${locale}
        WHERE vtc.embedding IS NOT NULL
          ${transcriptProvenanceFilter}
          AND vtc.language = ${locale}
        ORDER BY
          vt.video_id,
          vtc.embedding <=> qe.embedding,
          vtc.start_seconds ASC NULLS LAST,
          vtc.id ASC
      ),
      visible_semantic_candidates AS (
        SELECT
          b.video_id                       AS video_id,
          v.core_id                        AS video_core_id,
          v.slug                           AS video_slug,
          b.video_edition_id               AS video_edition_id,
          b.evidence_id                    AS evidence_id,
          b.evidence_source                AS evidence_source,
          b.scene_description              AS scene_description,
          b.start_seconds                  AS start_seconds,
          b.source_score                   AS source_score
        FROM best_transcript_per_video b
        JOIN video v ON v.id = b.video_id
          AND v.deleted_at IS NULL
        WHERE EXISTS (
          SELECT 1
          FROM video_locale vl_visible
          WHERE vl_visible.video_id = v.id
            AND vl_visible.locale = ${locale}
            AND vl_visible.status = 'published'
            AND vl_visible.deleted_at IS NULL
        )
      ),
      transcript_source AS (
        SELECT *
        FROM visible_semantic_candidates
        ORDER BY source_score DESC, start_seconds ASC NULLS LAST, evidence_id ASC
        LIMIT ${candidateLimit}
      ),
      requested_language AS MATERIALIZED (
        SELECT id
        FROM language
        WHERE bcp47 = ${locale}
      )
      SELECT
        ts.video_id                      AS video_id,
        ts.video_core_id                 AS video_core_id,
        ts.video_slug                    AS video_slug,
        display_locale.title             AS video_title,
        COALESCE(vi.mobile_cinematic_high, vi.url) AS image_url,
        ts.evidence_id                   AS evidence_id,
        ts.evidence_source               AS evidence_source,
        ts.scene_description             AS scene_description,
        ts.start_seconds                 AS start_seconds,
        dub_mux.playback_id              AS playback_id,
        ts.source_score                  AS source_score,
        vtc_final.embedding::text        AS embedding_text
      FROM transcript_source ts
      LEFT JOIN video_transcript_chunk vtc_final
        ON vtc_final.id = ts.evidence_id
      JOIN LATERAL (
        SELECT vl_display.title
        FROM video_locale vl_display
        WHERE vl_display.video_id = ts.video_id
          AND vl_display.locale = ${locale}
          AND vl_display.status = 'published'
          AND vl_display.deleted_at IS NULL
        ORDER BY
          vl_display.language_core_id ASC NULLS LAST,
          vl_display.language_slug ASC NULLS LAST,
          vl_display.id ASC
        LIMIT 1
      ) display_locale ON true
      LEFT JOIN LATERAL (
        SELECT mv.playback_id
        FROM video_dub vd
        LEFT JOIN mux_video mv ON mv.id = vd.mux_video_id
        WHERE vd.video_edition_id = ts.video_edition_id
          AND vd.deleted_at IS NULL
          AND vd.language_id IN (SELECT id FROM requested_language)
        ORDER BY vd.published DESC NULLS LAST, vd.updated_at DESC
        LIMIT 1
      ) dub_mux ON true
      LEFT JOIN LATERAL (
        SELECT vi2.mobile_cinematic_high, vi2.url
        FROM video_image vi2
        WHERE vi2.video_id = ts.video_id
          AND vi2.deleted_at IS NULL
        ORDER BY vi2.mobile_cinematic_high IS NULL, vi2.created_at
        LIMIT 1
      ) vi ON true
    `,
  )

  return mapVideoSemanticEvidenceRows(evidenceRows, limit)
}

/**
 * Per-locale keyword search over video_locale.title + description using
 * PostgreSQL tsvector/tsquery. The tsvector expression here MUST match
 * `VIDEO_LOCALE_TSVECTOR_INDEX_EXPR` from hybrid-search-sql.ts byte-for-byte
 * modulo alias (`vl.` prefix) so the GIN index in migration 0006 is
 * actually used. Any drift silently reverts the query to Seq Scan.
 *
 * DISTINCT ON (v.id) — one row per video. Empty/whitespace query
 * short-circuits to `[]` before any DB call.
 */
export async function searchVideoKeyword(
  prisma: PrismaClient,
  params: KeywordSearchParams,
  timing?: SearchTimingRecorder,
): Promise<VideoKeywordResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) return []

  const { locale, limit } = params
  const tsvector = Prisma.raw(VIDEO_LOCALE_TSVECTOR_QUERY_EXPR)

  const rows = await recordSearchDbTiming(
    timing,
    "keyword-video.query",
    () => prisma.$queryRaw<VideoKeywordRow[]>`
      SELECT * FROM (
        SELECT DISTINCT ON (v.id)
          v.id           AS video_id,
          v.core_id      AS video_core_id,
          v.slug         AS video_slug,
          vl.title       AS video_title,
          COALESCE(vi.mobile_cinematic_high, vi.url) AS image_url,
          vl.description AS description,
          dub_mux.playback_id AS playback_id,
          ts_rank(
            ${tsvector},
            plainto_tsquery('simple', ${trimmed})
          ) AS rank
        FROM video_locale vl
        JOIN video v ON v.id = vl.video_id
          AND v.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT vi2.mobile_cinematic_high, vi2.url
          FROM video_image vi2
          WHERE vi2.video_id = v.id
            AND vi2.deleted_at IS NULL
          ORDER BY vi2.mobile_cinematic_high IS NULL, vi2.created_at
          LIMIT 1
        ) vi ON true
        LEFT JOIN LATERAL (
          -- Only published dubs reach the public search response. An
          -- unpublished dub's playback_id is still a public Mux ID
          -- (HLS URL component, not a secret), but consumers expect
          -- search results to point at content they can actually play.
          -- Returning a draft dub's playback_id surfaces unfinished
          -- editorial work on the watch page.
          SELECT mv.playback_id
          FROM video_dub vd
          JOIN language lg ON lg.id = vd.language_id
            AND lg.bcp47 = ${locale}
          LEFT JOIN mux_video mv ON mv.id = vd.mux_video_id
          WHERE vd.video_id = v.id
            AND vd.published = true
            AND vd.deleted_at IS NULL
          ORDER BY vd.updated_at DESC
          LIMIT 1
        ) dub_mux ON true
        WHERE ${tsvector} @@ plainto_tsquery('simple', ${trimmed})
          AND vl.locale = ${locale}
          AND vl.status = 'published'
          AND vl.deleted_at IS NULL
        ORDER BY v.id, rank DESC
      ) sub
      ORDER BY sub.rank DESC
      LIMIT ${limit}
    `,
  )

  return rows.map((row) => ({
    resultType: "video" as const,
    resultId: row.video_id,
    videoCoreId: row.video_core_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    imageUrl: row.image_url ?? null,
    description: row.description,
    playbackId: row.playback_id ?? null,
    rank: Number(row.rank),
  }))
}

/**
 * Per-locale semantic search over ExperienceLocale embeddings.
 *
 * `resultId` is the ExperienceLocale.id (per-locale row), not the parent
 * Experience.id. Admin's data model stores each locale's slug + content +
 * embedding on its own row, so the locale row is the natural search
 * result identity. Consumer navigation is by `(locale, slug)` so the id
 * is opaque — this matches cms's behavior at the API boundary (cms just
 * happened to use the parent experience id because Strapi's i18n stores
 * locale variants under a shared `documentId` with distinct row ids per
 * locale; admin's cuid ExperienceLocale.id plays the same role).
 *
 * Filters: embedding non-null, matching locale, status='published',
 * parent experience non-archived.
 */
export async function searchExperienceSemantic(
  prisma: PrismaClient,
  params: SemanticSearchParams,
  timing?: SearchTimingRecorder,
): Promise<ExperienceSemanticResult[]> {
  const { queryEmbedding, locale, limit } = params

  const rows = await recordSearchDbTiming(
    timing,
    "semantic-experience.query",
    () => prisma.$queryRaw<ExperienceSemanticRow[]>`
      SELECT
        el.id               AS experience_locale_id,
        el.slug             AS slug,
        el.title            AS title,
        el.meta_description AS meta_description,
        1 - (el.embedding <=> ${queryEmbedding}::vector) AS similarity
      FROM experience_locale el
      JOIN experience e ON e.id = el.experience_id
        AND e.archived_at IS NULL
      WHERE el.embedding IS NOT NULL
        AND el.embedding_provider = ${QWEN_CONTENT_EMBEDDING_PROVIDER}
        AND el.embedding_model = ${QWEN_CONTENT_EMBEDDING_MODEL}
        AND el.embedding_dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND el.embedding_native_dimensions = ${QWEN_CONTENT_EMBEDDING_DIMENSIONS}
        AND el.embedding_transform_version IS NULL
        AND el.locale = ${locale}
        AND el.status = 'published'
      ORDER BY el.embedding <=> ${queryEmbedding}::vector
      LIMIT ${limit}
    `,
  )

  return rows.map((row) => ({
    resultType: "experience" as const,
    resultId: row.experience_locale_id,
    experienceSlug: row.slug ?? "",
    experienceTitle: row.title ?? "",
    experienceMetaDescription: row.meta_description,
    imageUrl: null,
    similarity: Number(row.similarity),
  }))
}

/**
 * Per-locale keyword search over experience_locale.title +
 * meta_description. Uses the same GIN index / tsvector expression as
 * the migration (see EXPERIENCE_LOCALE_TSVECTOR_INDEX_EXPR for the
 * byte-parity invariant).
 *
 * Empty/whitespace query short-circuits to `[]`.
 */
export async function searchExperienceKeyword(
  prisma: PrismaClient,
  params: KeywordSearchParams,
  timing?: SearchTimingRecorder,
): Promise<ExperienceKeywordResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) return []

  const { locale, limit } = params
  const tsvector = Prisma.raw(EXPERIENCE_LOCALE_TSVECTOR_QUERY_EXPR)

  const rows = await recordSearchDbTiming(
    timing,
    "keyword-experience.query",
    () => prisma.$queryRaw<ExperienceKeywordRow[]>`
      SELECT
        el.id               AS experience_locale_id,
        el.slug             AS slug,
        el.title            AS title,
        el.meta_description AS meta_description,
        ts_rank(
          ${tsvector},
          plainto_tsquery('simple', ${trimmed})
        ) AS rank
      FROM experience_locale el
      JOIN experience e ON e.id = el.experience_id
        AND e.archived_at IS NULL
      WHERE ${tsvector} @@ plainto_tsquery('simple', ${trimmed})
        AND el.locale = ${locale}
        AND el.status = 'published'
      ORDER BY rank DESC
      LIMIT ${limit}
    `,
  )

  return rows.map((row) => ({
    resultType: "experience" as const,
    resultId: row.experience_locale_id,
    experienceSlug: row.slug ?? "",
    experienceTitle: row.title ?? "",
    experienceMetaDescription: row.meta_description,
    imageUrl: null,
    rank: Number(row.rank),
  }))
}
