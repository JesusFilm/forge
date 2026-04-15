// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type ExperienceSemanticSearchParams = {
  queryEmbedding: string // pgvector text format "[0.1,0.2,...]"
  locale: string
  limit: number
}

export type ExperienceSemanticResult = {
  resultType: "experience"
  resultId: number
  experienceId: number
  experienceSlug: string
  experienceTitle: string
  experienceMetaDescription: string | null
  imageUrl: string | null
  similarity: number
}

type ExperienceSemanticRow = {
  experience_id: number
  slug: string
  title: string | null
  meta_description: string | null
  similarity: number
}

/**
 * Per-query semantic similarity over experience-level embeddings.
 *
 * Unlike video semantic search, experiences are localized entities — the
 * `experience_embeddings` table stores `locale` directly on the row, so
 * locale filtering is a simple WHERE clause with no link-table chain.
 *
 * The `UNIQUE(experience_id, locale)` constraint on `experience_embeddings`
 * guarantees one row per experience per locale, so no DISTINCT ON is needed.
 *
 * Image URL is `null` in v1 — the experience `og_image` field is a Strapi
 * media relation requiring a multi-table join (`files_related_morphs` →
 * `files`). Deferred to a follow-up if downstream consumers need it.
 */
const EXPERIENCE_SEMANTIC_SQL = `
  SELECT
    ee.experience_id,
    e.slug,
    e.title,
    e.meta_description,
    1 - (ee.embedding <=> ?::vector) AS similarity
  FROM experience_embeddings ee
  JOIN experiences e ON e.id = ee.experience_id
    AND e.published_at IS NOT NULL
  WHERE ee.locale = ?
  ORDER BY ee.embedding <=> ?::vector
  LIMIT ?
`

function mapRow(row: ExperienceSemanticRow): ExperienceSemanticResult {
  return {
    resultType: "experience",
    resultId: row.experience_id,
    experienceId: row.experience_id,
    experienceSlug: row.slug ?? "",
    experienceTitle: row.title ?? "",
    experienceMetaDescription: row.meta_description ?? null,
    imageUrl: null,
    similarity: Number(row.similarity),
  }
}

/**
 * Queries experience_embeddings with a pre-computed query embedding vector
 * via pgvector cosine similarity, returning the best-matching experiences
 * for the requested locale.
 *
 * @param knex                    - Knex database connection instance
 * @param params.queryEmbedding   - Embedding vector in pgvector text format "[0.1,0.2,...]"
 * @param params.locale           - Locale code matching experience_embeddings.locale
 * @param params.limit            - Maximum number of results to return
 */
export async function searchByExperienceSemantic(
  knex: KnexInstance,
  params: ExperienceSemanticSearchParams,
): Promise<ExperienceSemanticResult[]> {
  const result: { rows: ExperienceSemanticRow[] } = await knex.raw(
    EXPERIENCE_SEMANTIC_SQL,
    [params.queryEmbedding, params.locale, params.queryEmbedding, params.limit],
  )

  return result.rows.map(mapRow)
}
