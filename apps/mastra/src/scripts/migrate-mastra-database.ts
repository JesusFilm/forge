import { fileURLToPath, pathToFileURL } from "node:url"
import { Pool } from "pg"
import { getMastraDatabaseUrl } from "../config/env"
import {
  runDatabaseMigrations,
  type MigrationPool,
  type MigrationResult,
} from "./database-migrations"
export {
  parseVersion,
  type MigrationClient,
  type MigrationPool,
  type MigrationResult,
} from "./database-migrations"
export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
)

export function runMastraDatabaseMigrations(options: {
  pool: MigrationPool
  migrationsDirectory?: string
}): Promise<MigrationResult> {
  return runDatabaseMigrations({
    ...options,
    stream: "mastra",
    migrationsDirectory:
      options.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY,
  })
}

export async function runMastraDatabaseMigrationCli(): Promise<void> {
  const pool = new Pool({
    connectionString: getMastraDatabaseUrl(),
    max: 1,
    allowExitOnIdle: true,
  })
  try {
    const result = await runMastraDatabaseMigrations({ pool })
    process.stdout.write(
      `Mastra database migrations applied=${result.applied.length} skipped=${result.skipped.length}\n`,
    )
  } finally {
    await pool.end()
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await runMastraDatabaseMigrationCli()
}
