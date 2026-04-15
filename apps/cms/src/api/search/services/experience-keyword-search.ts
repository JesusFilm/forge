// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type ExperienceKeywordSearchParams = {
  query: string
  locale: string
  limit: number
}

export type ExperienceKeywordResult = {
  resultType: "experience"
  resultId: number
  experienceId: number
  experienceSlug: string
  experienceTitle: string
  experienceMetaDescription: string | null
  imageUrl: string | null
  rank: number
}

type ExperienceKeywordRow = {
  experience_id: number
  slug: string
  title: string | null
  meta_description: string | null
  rank: number
}

/**
 * Full-text keyword search on experiences.title + meta_description using
 * PostgreSQL tsvector/tsquery with locale-aware filtering.
 *
 * The tsvector expression matches the GIN index `experiences_fulltext_search_idx`
 * created in `bootstrap/ensure-pgvector.ts`. Any change to the expression
 * here must be mirrored there or the index will not be used.
 *
 * Experiences are localized entities — the `experiences.locale` column is a
 * direct filter, no link-table chain. The `UNIQUE(experience_id, locale)`
 * constraint on `experiences` (via Strapi i18n) means no DISTINCT ON is
 * needed — at most one row per experience per locale.
 *
 * Image URL is `null` in v1 — see experience-semantic-search.ts for context.
 */
const EXPERIENCE_KEYWORD_SEARCH_SQL = `
  SELECT
    e.id AS experience_id,
    e.slug,
    e.title,
    e.meta_description,
    ts_rank(
      to_tsvector('simple', coalesce(e.title, '') || ' ' || coalesce(e.meta_description, '')),
      plainto_tsquery('simple', ?)
    ) AS rank
  FROM experiences e
  WHERE to_tsvector('simple', coalesce(e.title, '') || ' ' || coalesce(e.meta_description, ''))
    @@ plainto_tsquery('simple', ?)
    AND e.locale = ?
    AND e.published_at IS NOT NULL
  ORDER BY rank DESC
  LIMIT ?
`

function mapRow(row: ExperienceKeywordRow): ExperienceKeywordResult {
  return {
    resultType: "experience",
    resultId: row.experience_id,
    experienceId: row.experience_id,
    experienceSlug: row.slug ?? "",
    experienceTitle: row.title ?? "",
    experienceMetaDescription: row.meta_description ?? null,
    imageUrl: null,
    rank: Number(row.rank),
  }
}

/**
 * Searches experiences by keyword using PostgreSQL full-text search.
 *
 * Returns an empty array for empty/whitespace-only queries (plainto_tsquery
 * would produce an empty tsquery which matches nothing, but we short-circuit
 * to avoid the round-trip).
 */
export async function searchByExperienceKeyword(
  knex: KnexInstance,
  params: ExperienceKeywordSearchParams,
): Promise<ExperienceKeywordResult[]> {
  const trimmed = params.query.trim()
  if (trimmed.length === 0) {
    return []
  }

  const result: { rows: ExperienceKeywordRow[] } = await knex.raw(
    EXPERIENCE_KEYWORD_SEARCH_SQL,
    [trimmed, trimmed, params.locale, params.limit],
  )

  return result.rows.map(mapRow)
}
