import { describe, expect, it } from "vitest"
import { runRollbackAiChatDeletion } from "./rollback-ai-chat-deletion.mjs"

describe("manual AI-chat rollback admission", () => {
  for (const argv of [
    ["--execute=true"],
    ["--execute", "--execute"],
    ["--confirm-database"],
    ["--unknown=secret"],
    ["stray-secret"],
    ["--confirm-database=abc"],
    ["--confirmed-paused"],
  ]) {
    it(`refuses malformed or inconsistent flags: ${argv[0]}`, async () => {
      const lines = []
      const code = await runRollbackAiChatDeletion(argv, {
        databaseUrl: "postgresql://user:secret@127.0.0.1:1/test",
        stdout: (line) => lines.push(line),
      })
      expect(code).toBe(1)
      expect(lines.join("\n")).toContain("reason=invalid_flags")
      expect(lines.join("\n")).not.toContain("secret")
      expect(lines.join("\n")).not.toContain("confirm_database=")
    })
  }
  it("requires an explicit DATABASE_URL, with no default connection", async () => {
    const lines = []
    expect(
      await runRollbackAiChatDeletion([], {
        databaseUrl: " ",
        stdout: (line) => lines.push(line),
      }),
    ).toBe(1)
    expect(lines.join("\n")).toContain("reason=database_url_required")
  })
  it("requires execution confirmation before connecting", async () => {
    const lines = []
    expect(
      await runRollbackAiChatDeletion(["--execute"], {
        databaseUrl: "postgresql://user:secret@127.0.0.1:1/test",
        stdout: (line) => lines.push(line),
      }),
    ).toBe(1)
    expect(lines.join("\n")).toContain("reason=execution_confirmation_required")
    expect(lines.join("\n")).not.toContain("secret")
  })
})
