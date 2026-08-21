import { pathToFileURL } from "node:url"

import {
  runMastraDatabaseMigrationCli,
  runMastraDatabaseMigrations,
} from "./migrate-mastra-database"

/** @deprecated Use runMastraDatabaseMigrations. Kept for operator compatibility. */
export const runDevotionalDatabaseMigrations = runMastraDatabaseMigrations

export {
  DEFAULT_MIGRATIONS_DIRECTORY,
  MIGRATION_POOL_TIMEOUTS,
  parseVersion,
  type MigrationClient,
  type MigrationPool,
  type MigrationResult,
} from "./migrate-mastra-database"

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await runMastraDatabaseMigrationCli()
}
