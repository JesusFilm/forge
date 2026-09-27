import { copyFile, mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { URL } from "node:url"

// Run after mastra build, which owns/cleans .mastra/output. Keep the SQL next
// to the manual entrypoint and resolve pg from the actual deployment artifact.
const output = new URL("../../.mastra/output/operations/", import.meta.url)
await mkdir(output, { recursive: true })
for (const file of [
  "rollback-ai-chat-deletion.mjs",
  "rollback-ai-chat-deletion.sql",
]) {
  await copyFile(new URL(file, import.meta.url), new URL(file, output))
}
const require = createRequire(new URL("rollback-ai-chat-deletion.mjs", output))
require.resolve("pg")
