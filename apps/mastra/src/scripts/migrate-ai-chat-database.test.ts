import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import {
  CHAT_MIGRATIONS_DIRECTORY,
  runAiChatDatabaseMigrations,
} from "./migrate-ai-chat-database"
import {
  CHAT_GUARD_BODY_MD5,
  CHAT_MIGRATION,
} from "../mastra/ai-chat-guard-manifest"
import type { MigrationClient } from "./database-migrations"

describe("chat migration contract", () => {
  it("pins checksums/function bodies to packaged SQL", async () => {
    const sql = await readFile(
      `${CHAT_MIGRATIONS_DIRECTORY}/${CHAT_MIGRATION.name}`,
      "utf8",
    )
    expect(createHash("sha256").update(sql).digest("hex")).toBe(
      CHAT_MIGRATION.sha256,
    )
    for (const [name, body] of Object.entries(CHAT_GUARD_BODY_MD5)) {
      const match = new RegExp(
        `CREATE FUNCTION ai_chat\\.${name}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
      ).exec(sql)
      expect(match).not.toBeNull()
      expect(createHash("md5").update(match![1]).digest("hex")).toBe(body)
    }
  })
  it("takes the independent advisory lock before native initialization and SQL; failure cannot commit", async () => {
    const calls: string[] = []
    const client: MigrationClient = {
      release() {
        calls.push("release")
      },
      async query(sql) {
        calls.push(sql)
        return { rows: [], command: "", rowCount: 0, oid: 0, fields: [] }
      },
    }
    await expect(
      runAiChatDatabaseMigrations({
        pool: { connect: async () => client },
        initialize: async () => {
          calls.push("initialize")
          throw new Error("synthetic init failure")
        },
      }),
    ).rejects.toThrow("synthetic init failure")
    expect(
      calls.findIndex((s) => s.includes("forge_ai_chat_migrations")),
    ).toBeLessThan(calls.indexOf("initialize"))
    expect(calls).toContain("rollback")
    expect(calls).not.toContain("commit")
    expect(calls.join()).not.toContain("forge_devotional_workspace_migrations")
    expect(calls.at(-1)).toBe("release")
  })
})
