import { describe, expect, it } from "vitest"

import {
  AI_CHAT_MAX_THREADS_PER_RESOURCE,
  authorizeAiChatThreadAccess,
  resolveOwnedExistingThread,
  type AiChatOwnershipMemory,
} from "./ai-chat-thread-ownership"

function fakeMemory(over: Partial<AiChatOwnershipMemory> = {}): {
  memory: AiChatOwnershipMemory
  listThreadsCalls: unknown[]
} {
  const listThreadsCalls: unknown[] = []
  const memory: AiChatOwnershipMemory = {
    getThreadById: async () => null,
    listThreads: async (args) => {
      listThreadsCalls.push(args)
      return { total: 0 }
    },
    ...over,
  }
  return { memory, listThreadsCalls }
}

describe("authorizeAiChatThreadAccess", () => {
  it("allows the owner of an existing thread", async () => {
    const { memory } = fakeMemory({
      getThreadById: async () => ({ resourceId: "user:alice" }),
    })
    const result = await authorizeAiChatThreadAccess({
      memory,
      threadId: "t1",
      resource: "user:alice",
    })
    expect(result).toEqual({ ok: true })
  })

  it("rejects a different resource on an existing thread with thread_forbidden", async () => {
    const { memory, listThreadsCalls } = fakeMemory({
      getThreadById: async () => ({ resourceId: "user:alice" }),
    })
    const result = await authorizeAiChatThreadAccess({
      memory,
      threadId: "t1",
      resource: "anon:mallory",
    })
    expect(result).toEqual({ ok: false, reason: "thread_forbidden" })
    // No ceiling lookup on the existing-thread branch.
    expect(listThreadsCalls).toHaveLength(0)
  })

  it("rejects a thread whose stored owner is missing (never fail open)", async () => {
    // A thread with no resourceId (shape drift / legacy row) must not be
    // adoptable by anyone — equality against undefined is false by design.
    const { memory } = fakeMemory({
      getThreadById: async () => ({ resourceId: undefined }),
    })
    const result = await authorizeAiChatThreadAccess({
      memory,
      threadId: "t1",
      resource: "user:alice",
    })
    expect(result).toEqual({ ok: false, reason: "thread_forbidden" })
  })

  it("allows a new thread under the ceiling and queries by the caller's resource", async () => {
    const { memory, listThreadsCalls } = fakeMemory({
      listThreads: async (args) => {
        listThreadsCalls.push(args)
        return { total: AI_CHAT_MAX_THREADS_PER_RESOURCE - 1 }
      },
    })
    const result = await authorizeAiChatThreadAccess({
      memory,
      threadId: "t-new",
      resource: "anon:someone",
    })
    expect(result).toEqual({ ok: true })
    expect(listThreadsCalls[0]).toMatchObject({
      filter: { resourceId: "anon:someone" },
    })
  })

  it("rejects a new thread at the ceiling with thread_limit", async () => {
    const { memory } = fakeMemory({
      listThreads: async () => ({ total: AI_CHAT_MAX_THREADS_PER_RESOURCE }),
    })
    const result = await authorizeAiChatThreadAccess({
      memory,
      threadId: "t-new",
      resource: "anon:someone",
    })
    expect(result).toEqual({ ok: false, reason: "thread_limit" })
  })

  it("propagates store failures so callers fail closed", async () => {
    const { memory } = fakeMemory({
      getThreadById: async () => {
        throw new Error("store down")
      },
    })
    await expect(
      authorizeAiChatThreadAccess({
        memory,
        threadId: "t1",
        resource: "user:alice",
      }),
    ).rejects.toThrow("store down")
  })
})

describe("resolveOwnedExistingThread (read path, feat-284)", () => {
  it("resolves ok for the owner of an existing thread", async () => {
    const { memory } = fakeMemory({
      getThreadById: async () => ({ resourceId: "user:alice" }),
    })
    const result = await resolveOwnedExistingThread({
      memory,
      threadId: "t1",
      resource: "user:alice",
    })
    expect(result).toEqual({ ok: true })
  })

  it("refuses a missing thread with thread_not_found — never an ok, never a ceiling lookup", async () => {
    const { memory, listThreadsCalls } = fakeMemory({
      getThreadById: async () => null,
    })
    const result = await resolveOwnedExistingThread({
      memory,
      threadId: "t-gone",
      resource: "user:alice",
    })
    expect(result).toEqual({ ok: false, reason: "thread_not_found" })
    // No ceiling branch on reads: listThreads is structurally out of the
    // resolver's reach (Pick<…, "getThreadById">) — pinned at runtime too.
    expect(listThreadsCalls).toHaveLength(0)
  })

  it("refuses a foreign owner with thread_forbidden", async () => {
    const { memory, listThreadsCalls } = fakeMemory({
      getThreadById: async () => ({ resourceId: "user:alice" }),
    })
    const result = await resolveOwnedExistingThread({
      memory,
      threadId: "t1",
      resource: "user:mallory",
    })
    expect(result).toEqual({ ok: false, reason: "thread_forbidden" })
    expect(listThreadsCalls).toHaveLength(0)
  })

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])(
    "refuses a thread whose stored owner is %s (never fail open)",
    async (_label, storedOwner) => {
      // Shape drift / legacy row without a resourceId must not be readable by
      // anyone — strict equality against undefined/null is false by design.
      const { memory } = fakeMemory({
        getThreadById: async () => ({ resourceId: storedOwner }),
      })
      const result = await resolveOwnedExistingThread({
        memory,
        threadId: "t1",
        resource: "user:alice",
      })
      expect(result).toEqual({ ok: false, reason: "thread_forbidden" })
    },
  )

  it("propagates store failures so callers fail closed (no try/catch inside)", async () => {
    const { memory } = fakeMemory({
      getThreadById: async () => {
        throw new Error("store down")
      },
    })
    await expect(
      resolveOwnedExistingThread({
        memory,
        threadId: "t1",
        resource: "user:alice",
      }),
    ).rejects.toThrow("store down")
  })
})
