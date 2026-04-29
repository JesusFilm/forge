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
 * - `imageUrl` is `null` for both corpora in R4 (cms parity). Wiring
 *   `ExperienceLocale.ogImageUrl` is a deliberate post-R8 follow-up.
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
  imageUrl: null
  sceneDescription: string
  startSeconds: number
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
  imageUrl: null
  description: string | null
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
  scene_description: string
  start_seconds: number
  playback_id: string | null
  similarity: number
  embedding_text: string
}

type VideoKeywordRow = {
  video_id: string
  video_core_id: string | null
  video_slug: string | null
  video_title: string | null
  description: string | null
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
 * Per-locale semantic search over VideoSceneLocale embeddings.
 *
 * One row per video (DISTINCT ON video_id) carrying the best-matching
 * scene for the requested locale. `playbackId` resolves via a LATERAL
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
): Promise<VideoSemanticResult[]> {
  const { queryEmbedding, locale, limit } = params

  const rows = await prisma.$queryRaw<VideoSemanticRow[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (vs.video_id)
        vs.video_id                       AS video_id,
        v.core_id                         AS video_core_id,
        v.slug                            AS video_slug,
        vl.title                          AS video_title,
        vsl.description                   AS scene_description,
        vs.start_seconds                  AS start_seconds,
        dub_mux.playback_id               AS playback_id,
        1 - (vsl.embedding <=> ${queryEmbedding}::vector) AS similarity,
        vsl.embedding::text               AS embedding_text
      FROM video_scene_locale vsl
      JOIN video_scene vs ON vs.id = vsl.video_scene_id
      JOIN video v ON v.id = vs.video_id
        AND v.deleted_at IS NULL
      JOIN video_locale vl
        ON vl.video_id = v.id
        AND vl.locale = ${locale}
        AND vl.status = 'published'
      LEFT JOIN LATERAL (
        SELECT mv.playback_id
        FROM video_dub vd
        JOIN language lg ON lg.id = vd.language_id
          AND lg.bcp47 = ${locale}

        LEFT JOIN mux_video mv ON mv.id = vd.mux_video_id
        WHERE vd.video_edition_id = vs.video_edition_id
          AND vd.deleted_at IS NULL
        ORDER BY vd.published DESC NULLS LAST, vd.updated_at DESC
        LIMIT 1
      ) dub_mux ON true
      WHERE vsl.embedding IS NOT NULL
        AND vsl.locale = ${locale}
      ORDER BY vs.video_id, vsl.embedding <=> ${queryEmbedding}::vector
    ) sub
    ORDER BY sub.similarity DESC
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    resultType: "video" as const,
    resultId: row.video_id,
    videoCoreId: row.video_core_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    imageUrl: null,
    sceneDescription: row.scene_description,
    startSeconds: Number(row.start_seconds),
    playbackId: row.playback_id,
    similarity: Number(row.similarity),
    embeddingText: row.embedding_text,
  }))
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
): Promise<VideoKeywordResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) return []

  const { locale, limit } = params
  const tsvector = Prisma.raw(VIDEO_LOCALE_TSVECTOR_QUERY_EXPR)

  const rows = await prisma.$queryRaw<VideoKeywordRow[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (v.id)
        v.id           AS video_id,
        v.core_id      AS video_core_id,
        v.slug         AS video_slug,
        vl.title       AS video_title,
        vl.description AS description,
        ts_rank(
          ${tsvector},
          plainto_tsquery('simple', ${trimmed})
        ) AS rank
      FROM video_locale vl
      JOIN video v ON v.id = vl.video_id
        AND v.deleted_at IS NULL
      WHERE ${tsvector} @@ plainto_tsquery('simple', ${trimmed})
        AND vl.locale = ${locale}
        AND vl.status = 'published'
      ORDER BY v.id, rank DESC
    ) sub
    ORDER BY sub.rank DESC
    LIMIT ${limit}
  `

  return rows.map((row) => ({
    resultType: "video" as const,
    resultId: row.video_id,
    videoCoreId: row.video_core_id,
    videoSlug: row.video_slug ?? "",
    videoTitle: row.video_title ?? "",
    imageUrl: null,
    description: row.description,
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
): Promise<ExperienceSemanticResult[]> {
  const { queryEmbedding, locale, limit } = params

  const rows = await prisma.$queryRaw<ExperienceSemanticRow[]>`
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
      AND el.locale = ${locale}
      AND el.status = 'published'
    ORDER BY el.embedding <=> ${queryEmbedding}::vector
    LIMIT ${limit}
  `

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
): Promise<ExperienceKeywordResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) return []

  const { locale, limit } = params
  const tsvector = Prisma.raw(EXPERIENCE_LOCALE_TSVECTOR_QUERY_EXPR)

  const rows = await prisma.$queryRaw<ExperienceKeywordRow[]>`
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
  `

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
