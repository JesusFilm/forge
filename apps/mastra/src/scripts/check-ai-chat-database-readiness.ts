import { Pool } from "pg"
import { pathToFileURL } from "node:url"
import { getAiChatGuardReadiness } from "../mastra/ai-chat-guard-readiness"
import { isAiChatDeletionStorageCovered } from "../mastra/ai-chat-memory"

export async function checkAiChatReadinessCli() {
  if (!process.env.DATABASE_URL?.trim())
    throw new Error("chat_database_url_required")
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  })
  pool.on("error", () => console.warn("chat_readiness_pool_error"))
  try {
    const readiness = await getAiChatGuardReadiness(pool)
    const covered = isAiChatDeletionStorageCovered()
    console.info(`chat_readiness state=${readiness} storage_covered=${covered}`)
    if (readiness !== "ready" || !covered) process.exitCode = 1
  } finally {
    await pool.end()
  }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    await checkAiChatReadinessCli()
  } catch {
    console.error("chat_readiness_failed")
    process.exitCode = 1
  }
}
