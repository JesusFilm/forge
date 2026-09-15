import { Pool } from "pg"
import { getMastraDatabaseUrl } from "../config/env"

/** Shared by history writes and lifecycle maintenance: no model-lifetime lease. */
export const AI_CHAT_WRITE_POOL_OPTIONS = {
  max: 2,
  allowExitOnIdle: true,
  connectionTimeoutMillis: 2_000,
  query_timeout: 5_000,
  statement_timeout: 5_000,
} as const
let pool: Pool | undefined
export function getAiChatWritePool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getMastraDatabaseUrl(),
      ...AI_CHAT_WRITE_POOL_OPTIONS,
    })
    pool.on("error", () =>
      console.warn("[ai-chat-history] event=rename_pool_idle_error"),
    )
  }
  return pool
}
export async function closeAiChatWritePool(): Promise<void> {
  const current = pool
  pool = undefined
  await current?.end()
}
export function resetAiChatWritePoolForTesting(): void {
  pool = undefined
}
