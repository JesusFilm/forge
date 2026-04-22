import type { Core } from "@strapi/strapi"

/**
 * Runs ANALYZE if the query planner has no statistics for large tables.
 *
 * After a pg_dump restore (data-import or manual), pg_stat_user_tables
 * shows n_live_tup = 0 for every table. The planner treats them as empty
 * and generates catastrophic query plans — sequential scans and nested
 * loops on million-row tables. This check detects that state and fixes it.
 *
 * Runs only once per database lifetime (autovacuum maintains stats after).
 */
export async function ensurePlannerStats(strapi: Core.Strapi): Promise<void> {
  const knex = strapi.db.connection

  const result = await knex.raw<{
    rows: Array<{ stale_count: string }>
  }>(`
    SELECT COUNT(*) AS stale_count
    FROM pg_stat_user_tables
    WHERE n_live_tup = 0
      AND pg_total_relation_size(relid) > 1048576
  `)

  const staleCount = Number(result.rows[0]?.stale_count ?? 0)
  if (staleCount === 0) return

  strapi.log.info(
    `[bootstrap] ${staleCount} large tables have no planner statistics — running ANALYZE`,
  )
  const start = Date.now()
  await knex.raw("ANALYZE")
  strapi.log.info(
    `[bootstrap] ANALYZE completed in ${((Date.now() - start) / 1000).toFixed(1)}s`,
  )
}
