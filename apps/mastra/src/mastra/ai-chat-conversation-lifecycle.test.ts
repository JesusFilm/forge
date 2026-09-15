import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getAiChatMemory,
  isAiChatDeletionStorageCovered,
} from "./ai-chat-memory"
import { deleteAiChatConversation } from "./ai-chat-conversation-lifecycle"

afterEach(() => vi.restoreAllMocks())
describe("storage coverage", () => {
  it("covers actual configured storage and refuses each unsupported enabled content store", async () => {
    const memory = getAiChatMemory()
    expect(isAiChatDeletionStorageCovered()).toBe(true)
    const base = memory.getMergedThreadConfig()
    const config = vi.spyOn(memory, "getMergedThreadConfig")
    for (const extra of [
      { semanticRecall: true },
      { workingMemory: { enabled: true } },
      { observationalMemory: true },
    ]) {
      config.mockReturnValue({ ...base, ...extra })
      expect(isAiChatDeletionStorageCovered()).toBe(false)
      await expect(
        deleteAiChatConversation("synthetic", "user:synthetic"),
      ).rejects.toMatchObject({ reason: "uncovered_storage" })
    }
  })
  it("rejects invalid IDs before acquiring a database", () => {
    for (const id of ["", " ", "x".repeat(201)])
      expect(() => deleteAiChatConversation(id, "user:synthetic")).toThrow(
        "invalid_identity",
      )
  })
})
