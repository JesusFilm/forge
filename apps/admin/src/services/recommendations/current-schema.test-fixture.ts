import { readdirSync, readFileSync } from "node:fs"

const migrationRoot = new URL("../../../prisma/migrations/", import.meta.url)

/**
 * Runtime-backed tests need the complete current recommendation schema, even
 * when their own feature predates a column selected by today's Prisma client.
 * Historical upgrade tests deliberately keep their separate fixed chains.
 * Watch surface and unrelated catalog migrations have their own fixtures.
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
  .map((name) =>
    readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8"),
  )
