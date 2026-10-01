import { readdirSync, readFileSync } from "node:fs"

const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)

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
      (name.includes("recommendation") ||
        name === "0057_semantic_control_readiness"),
  )
  .sort()
  .map((name) => {
    const sql = readFileSync(
      new URL(`${name}/migration.sql`, migrationRoot),
      "utf8",
    )
    return name === "0127_recommendation_legacy_stage_bulk_retirement"
      ? sql.replaceAll(
          "public.recommendation_candidate_",
          "recommendation_candidate_",
        )
      : sql
  })
