import { fileURLToPath, pathToFileURL } from "node:url"
import { Pool } from "pg"
import { PostgresStore } from "@mastra/pg"
import {
  runDatabaseMigrations,
  type MigrationPool,
} from "./database-migrations"
import { initializeAiChatStorage } from "../mastra/ai-chat-memory"
import { getAiChatGuardReadiness } from "../mastra/ai-chat-guard-readiness"

export const CHAT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../chat-migrations/", import.meta.url),
)

/** Initialization runs under the chat migrator's advisory lock, before SQL. */
export function runAiChatDatabaseMigrations(options: {
  pool: MigrationPool
  initialize: () => Promise<void>
  migrationsDirectory?: string
}) {
  return runDatabaseMigrations({
    ...options,
    stream: "ai-chat",
    migrationsDirectory:
      options.migrationsDirectory ?? CHAT_MIGRATIONS_DIRECTORY,
  })
}

export async function runAiChatDatabaseMigrationCli(): Promise<void> {
  // Never silently migrate the env resolver's fallback database.
  const connectionString = process.env.DATABASE_URL
  if (!connectionString?.trim()) throw new Error("chat_database_url_required")
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000,
  })
  pool.on("error", () => console.warn("chat_migration_pool_error"))
  const store = new PostgresStore({
    id: "ai-chat-migrator",
    connectionString,
    schemaName: "ai_chat",
    max: 1,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000,
  })
  try {
    const result = await runAiChatDatabaseMigrations({
      pool,
      initialize: () => initializeAiChatStorage(store),
    })
    const readiness = await getAiChatGuardReadiness(pool)
    if (readiness !== "ready")
      throw new Error("chat_migration_validation_failed")
    process.stdout.write(
      `chat_migrations applied=${result.applied.length} skipped=${result.skipped.length} readiness=${readiness}\n`,
    )
  } finally {
    await Promise.allSettled([pool.end(), store.close()])
  }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    await runAiChatDatabaseMigrationCli()
  } catch {
    console.error("chat_migration_failed")
    process.exitCode = 1
  }
}
