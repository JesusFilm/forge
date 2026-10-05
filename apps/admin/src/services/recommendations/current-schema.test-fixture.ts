import { readdirSync, readFileSync } from "node:fs"

const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)

function scopedMigrationSql(name: string): string {
  const sql = readFileSync(
    new URL(`${name}/migration.sql`, migrationRoot),
    "utf8",
  )
  if (name === "0127_recommendation_legacy_stage_bulk_retirement") {
    return sql.replaceAll(
      "public.recommendation_candidate_",
      "recommendation_candidate_",
    )
  }
  if (name === "0081_watch_search_transcript_publication_convergence") {
    return sql.replaceAll('"public".', "")
  }
  return sql
}

/** Current Admin DDL in a disposable test schema. Mastra owns its global
 * schema. The 0121 watch-exposure migration reconciles index OIDs in public
 * and is unrelated to recommendation contracts; its cross-schema OID checks
 * must not inspect or mutate the host's public indexes. */
export const currentAdminMigrationSql = readdirSync(migrationRoot)
  .filter(
    (name) =>
      /^\d{4}_/.test(name) &&
      name !== "0030_mastra_schema" &&
      name !== "0121_watch_exposure_narrow_index_reconciliation",
  )
  .sort()
  .map(scopedMigrationSql)

/**
 * Runtime-backed tests need the complete current recommendation schema, even
 * when their own feature predates a column selected by today's Prisma client.
 * Historical upgrade tests deliberately keep their separate fixed chains.
 * Watch surface and unrelated catalog migrations have their own fixtures.
 * The 0127 legacy-stage retirement names public explicitly. Resolve that
 * qualifier through the fixture's search_path so its lock, run update and
 * truncation execute against the isolated schema instead of public.
 */
export const recommendationRuntimeMigrationSql = readdirSync(migrationRoot)
  .filter(
    (name) =>
      /^\d{4}_/.test(name) &&
      Number(name.slice(0, 4)) >= 52 &&
      // This legacy request/trace fixture has no catalog video table. The
      // precomputed slice tests its migrations with the full Admin chain.
      !name.includes("recommendation_precomputed") &&
      (name.includes("recommendation") ||
        name === "0057_semantic_control_readiness"),
  )
  .sort()
  .map(scopedMigrationSql)
