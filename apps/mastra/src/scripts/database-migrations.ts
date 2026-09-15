import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { QueryResult, QueryResultRow } from "pg"
import { runDevotionalTransaction } from "../services/devotional/workspace/database"

// Fixed descriptors: callers cannot supply SQL identifiers or advisory keys.
const STREAMS = {
  mastra: {
    schema: "devotional_workspace",
    history: "devotional_workspace.schema_migrations",
    lock: "forge_devotional_workspace_migrations",
  },
  "ai-chat": {
    schema: "ai_chat",
    history: "ai_chat.forge_schema_migrations",
    lock: "forge_ai_chat_migrations",
  },
} as const

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
export async function runDatabaseMigrations(options: {
  stream: "mastra" | "ai-chat"
  initialize?: () => Promise<void>
  pool: MigrationPool
  migrationsDirectory: string
}): Promise<MigrationResult> {
  const migrationsDirectory = resolve(options.migrationsDirectory)
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => /^\d+-.+\.sql$/.test(filename))
    .sort((left, right) => parseVersion(left) - parseVersion(right))
  const result: MigrationResult = { applied: [], skipped: [] }

  const stream = STREAMS[options.stream]
  return runDevotionalTransaction(options.pool, async (client) => {
    if (options.stream === "ai-chat") {
      await client.query("set local lock_timeout = '2000ms'")
      await client.query("set local statement_timeout = '30000ms'")
    }
    await client.query(
      `select pg_advisory_xact_lock(hashtext('${stream.lock}'))`,
    )
    await options.initialize?.()
    await client.query(`create schema if not exists ${stream.schema}`)
    await client.query(
      `create table if not exists ${stream.history} (
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
           from ${stream.history}
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
        `insert into ${stream.history}
          (version, name, sha256) values ($1, $2, $3)`,
        [version, filename, sha256],
      )
      result.applied.push(filename)
    }

    return result
  })
}
