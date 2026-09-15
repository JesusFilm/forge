import { lstat, readFile, unlink, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Pool } from "pg"
import {
  captureCurrentChatMarkers,
  reconcileChatMarkers,
} from "../mastra/ai-chat-planned-restore"

export async function restoreAiChatMarkersCli(args: string[]) {
  const [operation, file, paused] = args
  if (
    !["capture", "reconcile"].includes(operation ?? "") ||
    !file ||
    paused !== "--confirmed-paused" ||
    args.length !== 3 ||
    !process.env.DATABASE_URL?.trim()
  )
    throw new Error("chat_recovery_arguments_required")
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  })
  pool.on("error", () => console.warn("chat_recovery_pool_error"))
  try {
    if (operation === "capture") {
      const input = await captureCurrentChatMarkers({ pool })
      await writeFile(file, JSON.stringify(input), { mode: 0o600, flag: "wx" })
      console.info(`chat_recovery_captured records=${input.count}`)
    } else {
      const stat = await lstat(file)
      if (!stat.isFile() || (stat.mode & 0o077) !== 0)
        throw new Error("chat_recovery_input_not_private")
      const input: unknown = JSON.parse(await readFile(file, "utf8"))
      const result = await reconcileChatMarkers(input, { pool })
      await unlink(file) // Only after committed reconciliation; failure keeps operations paused.
      console.info(
        `chat_recovery_reconciled records=${result.records} threads_removed=${result.threadsRemoved}`,
      )
    }
  } finally {
    await pool.end()
  }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    await restoreAiChatMarkersCli(process.argv.slice(2))
  } catch {
    console.error("chat_recovery_failed_keep_paused")
    process.exitCode = 1
  }
}
