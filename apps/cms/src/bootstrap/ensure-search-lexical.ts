import type { Core } from "@strapi/strapi"
import {
  DESCRIPTION_TSV_GENERATED_EXPR,
  TITLE_TSV_GENERATED_EXPR,
  VIDEOS_LEXICAL_WEIGHTED_INDEX_NAME,
  VIDEOS_TITLE_TRGM_INDEX_NAME,
  WEIGHTED_TSV_EXPR,
} from "../api/search/services/lexical-sql"

/**
 * Provision DB infrastructure for the opt-in keyword-first lexical
 * search mode (feat-109). Idempotent — safe to run on every boot.
 *
 * Installs:
 *   - `pg_trgm` extension (idempotent)
 *   - generated `videos.title_tsv` column (weight A target)
 *   - generated `videos.description_tsv` column (weight B target)
 *   - weighted GIN index on (setweight(title_tsv,'A') || setweight(description_tsv,'B'))
 *   - GIN trigram index on videos.title (gin_trgm_ops)
 *
 * The legacy `videos_fulltext_search_idx` (created by ensurePgvector)
 * is left untouched: hybrid mode keeps using `plainto_tsquery` against
 * the concatenated tsvector exactly as today. New columns and indexes
 * populate regardless of mode but are dormant on the hybrid path.
 *
 * Fails gracefully (warn + return) if pg_trgm cannot be installed —
 * keyword-first mode will simply Seq Scan in that case, but the rest
 * of the CMS still boots.
 *
 * GIN byte-parity invariant: the WEIGHTED_TSV_EXPR string is the
 * single source of truth shared with the keyword-first retriever.
 * Drift between the index expression here and the WHERE expression
 * in the retriever silently disables the index. Tests assert
 * byte-equality.
 *
 * **Generated-column expression drift**: `ADD COLUMN IF NOT EXISTS`
 * is column-NAME-aware, not expression-aware. If a future change
 * edits TITLE_TSV_GENERATED_EXPR (e.g. swaps 'simple' for 'english',
 * or adds another coalesced field), every database that already has
 * the old column will silently no-op and continue using the stale
 * expression. Any change to the generated expression therefore
 * REQUIRES an explicit migration step that drops the column with
 * CASCADE before this bootstrap re-creates it. Same applies to
 * description_tsv. There is no automated drift detection; reviewers
 * must catch this.
 */
export async function ensureSearchLexical(strapi: Core.Strapi): Promise<void> {
  const knex = strapi.db.connection

  try {
    await knex.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm")
  } catch (err) {
    strapi.log.warn(
      `[search-lexical] pg_trgm not available, keyword-first mode will Seq Scan: ${
        err instanceof Error ? err.message : err
      }`,
    )
    return
  }

  strapi.log.info("[search-lexical] pg_trgm extension enabled")

  try {
    await knex.raw(`
      ALTER TABLE videos
        ADD COLUMN IF NOT EXISTS title_tsv tsvector
        GENERATED ALWAYS AS (${TITLE_TSV_GENERATED_EXPR}) STORED
    `)

    await knex.raw(`
      ALTER TABLE videos
        ADD COLUMN IF NOT EXISTS description_tsv tsvector
        GENERATED ALWAYS AS (${DESCRIPTION_TSV_GENERATED_EXPR}) STORED
    `)

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS ${VIDEOS_LEXICAL_WEIGHTED_INDEX_NAME}
        ON videos USING gin (${WEIGHTED_TSV_EXPR})
    `)

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS ${VIDEOS_TITLE_TRGM_INDEX_NAME}
        ON videos USING gin (title gin_trgm_ops)
    `)

    strapi.log.info("[search-lexical] generated columns and GIN indexes ready")
  } catch (err) {
    strapi.log.warn(
      `[search-lexical] Failed to provision generated columns or indexes (videos table may not exist yet): ${
        err instanceof Error ? err.message : err
      }`,
    )
  }
}
