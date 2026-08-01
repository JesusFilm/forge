import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { Pool, type QueryResult, type QueryResultRow } from "pg"

import { getDevotionalWorkspaceEnvironment } from "../config/env"
import {
  DEVOTIONAL_WORKSPACE_SCHEMA,
  runDevotionalTransaction,
} from "../services/devotional/workspace/database"

export type MigrationClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>
  release(): void
}

export type MigrationPool = {
  connect(): Promise<MigrationClient>
}

export type MigrationResult = {
  applied: string[]
  skipped: string[]
}

const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
)

function parseVersion(filename: string): number {
  const match = /^(\d+)-.+\.sql$/.exec(filename)
  if (!match)
    throw new Error(`invalid devotional migration filename: ${filename}`)
  return Number(match[1])
}

/** Apply immutable, checksum-verified SQL migrations under one advisory lock. */
export async function runDevotionalDatabaseMigrations(options: {
  pool: MigrationPool
  migrationsDirectory?: string
}): Promise<MigrationResult> {
  const migrationsDirectory = resolve(
    options.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY,
  )
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => /^\d+-.+\.sql$/.test(filename))
    .sort((left, right) => parseVersion(left) - parseVersion(right))
  const result: MigrationResult = { applied: [], skipped: [] }

  return runDevotionalTransaction(options.pool, async (client) => {
    await client.query(
      "select pg_advisory_xact_lock(hashtext('forge_devotional_workspace_migrations'))",
    )
    await client.query(
      `create schema if not exists ${DEVOTIONAL_WORKSPACE_SCHEMA}`,
    )
    await client.query(
      `create table if not exists ${DEVOTIONAL_WORKSPACE_SCHEMA}.schema_migrations (
        version integer primary key check (version > 0),
        name text not null,
        sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz not null default now()
      )`,
    )

    for (const filename of filenames) {
      const version = parseVersion(filename)
      const sql = await readFile(resolve(migrationsDirectory, filename), "utf8")
      const sha256 = createHash("sha256").update(sql).digest("hex")
      const existing = await client.query<{ sha256: string; name: string }>(
        `select sha256, name
           from ${DEVOTIONAL_WORKSPACE_SCHEMA}.schema_migrations
          where version = $1`,
        [version],
      )

      if (existing.rows[0]) {
        if (
          existing.rows[0].sha256 !== sha256 ||
          existing.rows[0].name !== filename
        ) {
          throw new Error(
            `devotional migration ${version} differs from the applied checksum`,
          )
        }
        result.skipped.push(filename)
        continue
      }

      await client.query(sql)
      await client.query(
        `insert into ${DEVOTIONAL_WORKSPACE_SCHEMA}.schema_migrations
          (version, name, sha256) values ($1, $2, $3)`,
        [version, filename, sha256],
      )
      result.applied.push(filename)
    }

    return result
  })
}

async function main(): Promise<void> {
  const environment = getDevotionalWorkspaceEnvironment()
  const pool = new Pool({
    connectionString: environment.databaseUrl,
    max: 1,
    allowExitOnIdle: true,
  })
  try {
    const result = await runDevotionalDatabaseMigrations({ pool })
    process.stdout.write(
      `Devotional database migrations applied=${result.applied.length} skipped=${result.skipped.length}\n`,
    )
  } finally {
    await pool.end()
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main()
}

export { DEFAULT_MIGRATIONS_DIRECTORY, parseVersion }
