import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg"

import { getMastraDatabaseUrl } from "../config/env"
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

const MIGRATION_STATEMENT_TIMEOUT_MS = 300_000
const MIGRATION_LOCK_TIMEOUT_MS = 15_000
export const MIGRATION_POOL_TIMEOUTS = {
  connectionTimeoutMillis: MIGRATION_LOCK_TIMEOUT_MS,
  query_timeout: MIGRATION_STATEMENT_TIMEOUT_MS,
  statement_timeout: MIGRATION_STATEMENT_TIMEOUT_MS,
} satisfies PoolConfig

export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
)

export function parseVersion(filename: string): number {
  const match = /^(\d+)-.+\.sql$/.exec(filename)
  if (!match) throw new Error(`invalid Mastra migration filename: ${filename}`)
  return Number(match[1])
}

/**
 * Apply immutable Mastra SQL migrations under the existing advisory lock and
 * metadata table. Reusing that metadata is required so deployments that have
 * already applied 001 do not replay it after this migrator was generalized.
 */
export async function runMastraDatabaseMigrations(options: {
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
      `set local statement_timeout = '${MIGRATION_STATEMENT_TIMEOUT_MS}ms'`,
    )
    await client.query(
      `set local lock_timeout = '${MIGRATION_LOCK_TIMEOUT_MS}ms'`,
    )
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
            `Mastra migration ${version} differs from the applied checksum`,
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

export async function runMastraDatabaseMigrationCli(): Promise<void> {
  const pool = new Pool({
    connectionString: getMastraDatabaseUrl(),
    max: 1,
    allowExitOnIdle: true,
    ...MIGRATION_POOL_TIMEOUTS,
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
